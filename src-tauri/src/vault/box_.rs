// 保险箱目录管理、锁定状态机（技术文档 §7 + F-23~F-25）
use super::crypto;
use crate::index::db::Db;
use rusqlite::params;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq)]
pub enum VaultState {
    NotCreated,
    Locked,
    Unlocked {
        /// 解锁后密钥仅驻内存（配合 mlock 的平台调用在 M3 接入）
        key: [u8; 32],
    },
}

const VAULT_DIR: &str = ".filefly/vault"; // 保险箱文件在磁盘上始终为密文

pub fn vault_dir() -> std::path::PathBuf {
    crate::dirs().join("vault")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub created: bool,
    pub locked: bool,
    pub item_count: usize,
    pub has_second_password: bool,
    pub hint: String,
}

pub fn status(db: &Db, state: &VaultState) -> VaultStatus {
    let conn = db.conn.lock();
    let created: bool = conn
        .query_row("SELECT COUNT(*) FROM vault_meta", [], |r| r.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    let has_second: bool = conn
        .query_row("SELECT second_verifier IS NOT NULL FROM vault_meta", [], |r| r.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    let hint: String = conn
        .query_row("SELECT COALESCE(hint, '') FROM vault_meta", [], |r| r.get(0))
        .unwrap_or_default();
    let item_count = if created {
        conn.query_row("SELECT COUNT(*) FROM vault_items", [], |r| r.get::<_, i64>(0))
            .map(|c| c as usize)
            .unwrap_or(0)
    } else {
        0
    };
    VaultStatus {
        created,
        locked: matches!(state, VaultState::Locked) && created,
        item_count,
        has_second_password: has_second,
        hint,
    }
}

/// 创建保险箱：主密码 + 可选第二道密码 + 提示问题；返回 24 词恢复密钥（仅展示一次）
pub fn create(
    db: &Db,
    master_password: &str,
    second_password: Option<&str>,
    hint: &str,
) -> Result<Vec<String>, String> {
    if master_password.len() < 6 {
        return Err("主密码至少 6 位".into());
    }
    std::fs::create_dir_all(vault_dir()).map_err(|e| e.to_string())?;

    let mut salt = [0u8; crypto::SALT_LEN];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    let key = crypto::derive_key(master_password, &salt);
    let verifier = crypto::verifier_of(&key);

    let (second_salt, second_verifier): (Option<Vec<u8>>, Option<Vec<u8>>) =
        if let Some(sp) = second_password.filter(|s| !s.is_empty()) {
            let mut s2 = [0u8; crypto::SALT_LEN];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut s2);
            let k2 = crypto::derive_key(sp, &s2);
            (Some(s2.to_vec()), Some(crypto::verifier_of(&k2).to_vec()))
        } else {
            (None, None)
        };

    db.conn.lock()
        .execute(
            "INSERT OR REPLACE INTO vault_meta(id, kdf_salt, verifier, second_salt, second_verifier, hint, created_at)
             VALUES(1, ?1, ?2, ?3, ?4, ?5, strftime('%s','now'))",
            params![salt.to_vec(), verifier.to_vec(), second_salt, second_verifier, hint],
        )
        .map_err(|e| e.to_string())?;
    Ok(crypto::generate_recovery_key())
}

/// 解锁主密码（F-24：失败次数限制由前端 5 次锁定 60s 实现；此处校验）
pub fn unlock(db: &Db, password: &str) -> Result<VaultState, String> {
    let conn = db.conn.lock();
    let (salt, verifier): (Vec<u8>, Vec<u8>) = conn
        .query_row("SELECT kdf_salt, verifier FROM vault_meta WHERE id = 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| "保险箱尚未创建".to_string())?;
    drop(conn);
    let key = crypto::derive_key(password, &salt);
    if crypto::verifier_of(&key) != verifier.as_slice() {
        return Err("MASTER_PASSWORD_WRONG".into());
    }
    Ok(VaultState::Unlocked { key })
}

/// 校验第二道密码（浏览敏感条目时要求，F-24 双重保护）
pub fn verify_second(db: &Db, password: &str) -> bool {
    let conn = db.conn.lock();
    let (salt, verifier): (Option<Vec<u8>>, Option<Vec<u8>>) = conn
        .query_row("SELECT second_salt, second_verifier FROM vault_meta WHERE id = 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap_or((None, None));
    match (salt, verifier) {
        (Some(s), Some(v)) => crypto::verifier_of(&crypto::derive_key(password, &s)) == v.as_slice(),
        _ => true, // 未设置第二道密码
    }
}

/// 设置/修改/清除第二道密码（需已解锁；第二道密码是独立于主密码的查看门锁，
/// 不参与内容加密，因此设置/修改无需重加密任何条目）。传 None 或空串表示清除。
pub fn set_second_password(db: &Db, new_second: Option<&str>) -> Result<(), String> {
    let (salt, verifier): (Option<Vec<u8>>, Option<Vec<u8>>) = match new_second.filter(|s| !s.is_empty()) {
        Some(pw) => {
            if pw.len() < 6 {
                return Err("第二道密码至少 6 位".into());
            }
            let mut s = [0u8; crypto::SALT_LEN];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut s);
            let k = crypto::derive_key(pw, &s);
            (Some(s.to_vec()), Some(crypto::verifier_of(&k).to_vec()))
        }
        None => (None, None), // 清除
    };
    db.conn.lock()
        .execute(
            "UPDATE vault_meta SET second_salt = ?1, second_verifier = ?2 WHERE id = 1",
            params![salt, verifier],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 通过恢复密钥重置主密码（明确边界：无法暴力找回，仅 24 词可恢复，F-25）
pub fn recover_reset(db: &Db, words: &[String], new_password: &str) -> Result<Vec<String>, String> {
    if crypto::recovery_key_hash(words).as_slice()
        != {
            // 恢复密钥校验值存于 settings
            let conn = db.conn.lock();
            conn.query_row("SELECT value FROM settings WHERE key = 'recovery_verifier'", [], |r| {
                r.get::<_, String>(0)
            })
            .map(|s| {
                let bytes: Vec<u8> = serde_json::from_str(&s).unwrap_or_default();
                bytes
            })
            .unwrap_or_default()
        }
    {
        return Err("恢复密钥不正确".into());
    }
    let new_words = create(db, new_password, None, "")?;
    Ok(new_words)
}

/// 修改主密码：校验旧密码 → 新盐派生新密钥 → 内存中完成全部条目重加密 →
/// 先写文件（失败回滚原 blob）→ 再更新条目名称密文 → 最后更新 vault_meta（新盐 + 新校验值）。
/// 第二道密码独立于主密码，不受影响；旧版未迁移条目（独立密码+盐自包含）原样跳过。
/// 返回成功重加密的条目数。
pub fn change_master_password(
    db: &Db,
    old_password: &str,
    new_password: &str,
) -> Result<usize, String> {
    if new_password.len() < 6 {
        return Err("新主密码至少 6 位".into());
    }
    if old_password == new_password {
        return Err("新主密码不能与旧密码相同".into());
    }

    // 1. 校验旧密码并取旧主密钥
    let old_key: [u8; 32] = match unlock(db, old_password)? {
        VaultState::Unlocked { key } => key,
        _ => return Err("VAULT_LOCKED".into()),
    };

    // 2. 新盐 → 新密钥 → 新校验值
    let mut new_salt = [0u8; crypto::SALT_LEN];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut new_salt);
    let new_key = crypto::derive_key(new_password, &new_salt);
    let new_verifier = crypto::verifier_of(&new_key);

    // 3. 全部条目在内存中完成 解密→重加密，任何失败先报错、不落盘
    let conn = db.conn.lock();
    let rows: Vec<(i64, String, Vec<u8>)> = conn
        .prepare("SELECT id, enc_path, enc_name FROM vault_items")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok((r.get(0)?, r.get::<_, String>(1)?, row_bytes(r, 2))))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(conn);

    // (id, path, old_blob, new_blob, old_enc_name, new_enc_name)
    let mut prepared: Vec<(i64, String, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>)> = Vec::new();
    let mut reencrypted = 0usize;
    for (id, enc_path, enc_name) in rows {
        let old_blob = std::fs::read(&enc_path)
            .map_err(|e| format!("读取加密文件失败（id={}）：{}", id, e))?;
        // 主密钥可解 → 当前格式，重加密；解不开 → 旧版独立密码条目，blob 自包含盐，与主密码无关，跳过
        match crypto::decrypt_with_key(&old_blob, &old_key) {
            Ok(plain) => {
                // enc_name 在库中是密文：先用旧密钥解出明文，再用新密钥加密
                let plain_name = match crypto::decrypt_with_key(&enc_name, &old_key) {
                    Ok(b) => b,
                    Err(_) => continue, // 名称不可解（旧版条目），保持原样
                };
                let new_blob = crypto::encrypt_with_key(&plain, &new_key)?;
                let new_enc_name = crypto::encrypt_with_key(&plain_name, &new_key)?;
                prepared.push((id, enc_path, old_blob, new_blob, enc_name, new_enc_name));
                reencrypted += 1;
            }
            Err(_) => continue,
        }
    }

    // 4. 写盘：逐文件替换；中途失败则把已写的恢复为原内容
    let mut written: Vec<usize> = Vec::new(); // 已写入的 prepared 下标
    for (i, (_, path, _, new_blob, _, _)) in prepared.iter().enumerate() {
        if let Err(e) = std::fs::write(path, new_blob) {
            for j in &written {
                let (_, p, ob, _, _, _) = &prepared[*j];
                let _ = std::fs::write(p, ob);
            }
            return Err(format!("写入重加密文件失败：{}", e));
        }
        written.push(i);
    }

    // 5. 更新条目名称密文（enc_name 以主密钥加密，需同步换钥）；失败回滚文件与名称
    let mut names_result: Result<(), String> = Ok(());
    for (id, _, _, _, _, new_enc) in &prepared {
        if let Err(e) = db.conn.lock().execute(
            "UPDATE vault_items SET enc_name = ?1 WHERE id = ?2",
            params![new_enc, id],
        ) {
            names_result = Err(e.to_string());
            break;
        }
    }
    if let Err(e) = names_result {
        for (id, path, old_blob, _, old_enc, _) in &prepared {
            let _ = db.conn.lock().execute(
                "UPDATE vault_items SET enc_name = ?1 WHERE id = ?2",
                params![old_enc, id],
            );
            let _ = std::fs::write(path, old_blob);
        }
        return Err(format!("更新条目名称密文失败：{}", e));
    }

    // 6. 最后更新 meta（新盐 + 新校验值）；失败则整体回滚文件与名称密文
    if let Err(e) = db.conn.lock().execute(
        "UPDATE vault_meta SET kdf_salt = ?1, verifier = ?2 WHERE id = 1",
        params![new_salt.to_vec(), new_verifier.to_vec()],
    ) {
        for (id, path, old_blob, _, old_enc, _) in &prepared {
            let _ = std::fs::write(path, old_blob);
            let _ = db.conn.lock().execute(
                "UPDATE vault_items SET enc_name = ?1 WHERE id = ?2",
                params![old_enc, id],
            );
        }
        return Err(format!("更新密钥元数据失败：{}", e));
    }

    Ok(reencrypted)
}
pub fn add_item(db: &Db, src_path: &str, key: &[u8; 32]) -> Result<(), String> {
    let plain = std::fs::read(src_path).map_err(|e| e.to_string())?;
    let orig_name = std::path::Path::new(src_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".into());
    let enc_name = crypto::encrypt_with_key(orig_name.as_bytes(), key)?;
    let blob = crypto::encrypt_with_key(&plain, key)?;
    let fname = format!("{}.ffb", uuid_like());
    let dest = vault_dir().join(&fname);
    std::fs::create_dir_all(vault_dir()).map_err(|e| e.to_string())?;
    std::fs::write(&dest, &blob).map_err(|e| e.to_string())?;
    db.conn.lock()
        .execute(
            "INSERT INTO vault_items(enc_name, enc_path, added_at) VALUES(?1, ?2, strftime('%s','now'))",
            params![enc_name, dest.to_string_lossy()],
        )
        .map_err(|e| e.to_string())?;
    // 原文件移入系统回收站（可恢复，与 UI 提示一致）；回收站不可用时回退为直接删除
    if trash::delete(src_path).is_err() {
        std::fs::remove_file(src_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 行值容错读取：新条目为 BLOB，旧版条目曾以 TEXT 写入（rusqlite 类型严格，需按实际类型取）
fn row_bytes(r: &rusqlite::Row<'_>, idx: usize) -> Vec<u8> {
    use rusqlite::types::ValueRef;
    match r.get_ref(idx) {
        Ok(ValueRef::Blob(b)) => b.to_vec(),
        Ok(ValueRef::Text(t)) => t.to_vec(),
        Ok(ValueRef::Integer(i)) => i.to_le_bytes().to_vec(),
        Ok(ValueRef::Real(f)) => f.to_le_bytes().to_vec(),
        _ => Vec::new(),
    }
}

/// 浏览走解密流（虚拟目录）：解锁后用主密钥解密条目名
pub fn list_items(db: &Db, key: &[u8; 32]) -> Result<Vec<VaultItem>, String> {
    let conn = db.conn.lock();
    let rows: Vec<(i64, Vec<u8>, String, i64)> = conn
        .prepare("SELECT id, enc_name, enc_path, added_at FROM vault_items ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?
        .query_map([], |r| {
            Ok((r.get(0)?, row_bytes(r, 1), r.get::<_, String>(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(conn);
    let mut out = Vec::new();
    for (id, enc_name, enc_path, added_at) in rows {
        // 新格式：密文名称；旧格式（TEXT 随机文件名）：解密必失败，显示原始 .ffb 名
        let name = crypto::decrypt_with_key(&enc_name, key)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_else(|| {
                let s = String::from_utf8_lossy(&enc_name).to_string();
                if s.ends_with(".ffb") { format!("（旧版条目）{}", &s[..s.len().min(12)]) } else { "<加密名称>".into() }
            });
        out.push(VaultItem { id, name, enc_path, added_at });
    }
    Ok(out)
}

/// 根据内容魔数识别文件类型（旧版迁移条目的原始扩展名已丢失，按内容补全后系统才能选对默认打开程序）
pub fn sniff_ext(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) { return Some("png"); }
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) { return Some("jpg"); }
    if data.starts_with(b"GIF8") { return Some("gif"); }
    if data.starts_with(b"BM") && data.len() > 26 { return Some("bmp"); }
    if data.starts_with(b"%PDF") { return Some("pdf"); }
    if data.starts_with(b"PK") {
        // OOXML 容器（docx/xlsx/pptx 本质是 zip）：扫前 64KB 找包内特征目录名
        let head = &data[..data.len().min(65536)];
        for (pat, ext) in [(b"word/"[..].as_ref(), "docx"), (b"xl/".as_ref(), "xlsx"), (b"ppt/".as_ref(), "pptx")] {
            if head.windows(pat.len()).any(|w| w == pat) { return Some(ext); }
        }
        return Some("zip");
    }
    if data.starts_with(b"Rar!") { return Some("rar"); }
    if data.starts_with(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) { return Some("7z"); }
    if data.len() > 10 && &data[4..8] == b"ftyp" { return Some("mp4"); }
    if data.starts_with(b"ID3") || (data.len() > 2 && data[0] == 0xFF && (data[1] & 0xE0) == 0xE0) { return Some("mp3"); }
    if data.starts_with(b"RIFF") && data.len() > 12 && &data[8..12] == b"WEBP" { return Some("webp"); }
    // 纯文本启发：无 NUL 且 ≥95% 字节为可打印/常见控制符/多字节高位
    if !data.is_empty() && !data.iter().any(|&b| b == 0)
        && data.iter().filter(|&&b| b == 9 || b == 10 || b == 13 || (0x20..=0x7E).contains(&b) || b >= 0x80).count() * 20 >= data.len() * 19 {
        return Some("txt");
    }
    None
}

/// 名称无扩展名时按内容补全（已有扩展名的名称原样保留）
fn ensure_ext(name: &str, data: &[u8]) -> String {
    if std::path::Path::new(name).extension().is_some() {
        return name.to_string();
    }
    match sniff_ext(data) {
        Some(ext) => format!("{}.{}", name, ext),
        None => name.to_string(),
    }
}

/// 解锁时迁移旧版条目：旧条目以「用户当时输入的密码」加密（内容含独立盐）。
/// 若该密码恰为主密码，则用主密钥重新加密（名称以 .ffb 文件名替代，原始名旧版未保存）；
/// 迁移失败（当时输入的是其他密码）的条目保持原样，列表中标注旧版。
pub fn migrate_legacy(db: &Db, master_password: &str, key: &[u8; 32]) -> usize {
    let conn = db.conn.lock();
    let rows: Vec<(i64, Vec<u8>, String)> = match conn
        .prepare("SELECT id, enc_name, enc_path FROM vault_items")
        .and_then(|mut s| {
            s.query_map([], |r| Ok((r.get(0)?, row_bytes(r, 1), r.get::<_, String>(2)?)))
                .map(|it| it.filter_map(|x| x.ok()).collect::<Vec<_>>())
        }) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    drop(conn);
    let mut migrated = 0;
    for (id, enc_name, enc_path) in rows {
        // 已是新格式（主密钥可解名称）→ 跳过
        if crypto::decrypt_with_key(&enc_name, key).is_ok() {
            continue;
        }
        let blob = match std::fs::read(&enc_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        // 旧内容：[magic][盐16B][nonce12B][ct]，用「存入时输入的密码」派生
        if crypto::decrypt_bytes(&blob, master_password).is_err() {
            continue; // 当时输的不是主密码，无法自动迁移
        }
        let plain = crypto::decrypt_bytes(&blob, master_password).unwrap_or_default();
        let display_name = {
            let s = String::from_utf8_lossy(&enc_name).to_string();
            // 原始名旧版未保存：用"已迁移_<hash>" + 按内容识别的扩展名（打开时才能选对默认程序）
            let base = if s.ends_with(".ffb") { format!("已迁移_{}", &s[..s.len().min(8)]) } else { "已迁移条目".into() };
            ensure_ext(&base, &plain)
        };
        let enc_name_new = match crypto::encrypt_with_key(display_name.as_bytes(), key) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let new_blob = match crypto::encrypt_with_key(&plain, key) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if std::fs::write(&enc_path, &new_blob).is_err() {
            continue;
        }
        if db.conn.lock()
            .execute("UPDATE vault_items SET enc_name = ?1 WHERE id = ?2", params![enc_name_new, id])
            .is_ok()
        {
            migrated += 1;
        }
    }
    migrated
}

/// 补全已迁移条目的扩展名（一次性，解锁时自动执行、幂等）：
/// 早期迁移版本未按内容识别类型，名称无扩展名 → 解密内容按魔数识别后写入名称。
/// 返回补全的条目数。
pub fn complete_legacy_names(db: &Db, key: &[u8; 32]) -> usize {
    let conn = db.conn.lock();
    let rows: Vec<(i64, Vec<u8>, String)> = match conn
        .prepare("SELECT id, enc_name, enc_path FROM vault_items")
        .and_then(|mut s| {
            s.query_map([], |r| Ok((r.get(0)?, row_bytes(r, 1), r.get::<_, String>(2)?)))
                .map(|it| it.filter_map(|x| x.ok()).collect::<Vec<_>>())
        }) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    drop(conn);
    let mut fixed = 0;
    for (id, enc_name, enc_path) in rows {
        let name = match crypto::decrypt_with_key(&enc_name, key).ok().and_then(|b| String::from_utf8(b).ok()) {
            Some(n) => n,
            None => continue, // 名称不可解（未迁移的旧版条目），跳过
        };
        if std::path::Path::new(&name).extension().is_some() { continue; } // 已有扩展名，幂等跳过
        let blob = match std::fs::read(&enc_path) { Ok(b) => b, Err(_) => continue };
        let plain = match crypto::decrypt_with_key(&blob, key) { Ok(p) => p, Err(_) => continue };
        let ext = match sniff_ext(&plain) { Some(e) => e, None => continue }; // 识别不出类型，保持原样
        let new_name = format!("{}.{}", name, ext);
        let enc_new = match crypto::encrypt_with_key(new_name.as_bytes(), key) { Ok(v) => v, Err(_) => continue };
        if db.conn.lock()
            .execute("UPDATE vault_items SET enc_name = ?1 WHERE id = ?2", params![enc_new, id])
            .is_ok()
        {
            fixed += 1;
        }
    }
    fixed
}

/// 解密导出条目（打开）：使用主密钥，导出文件保留原始文件名
pub fn open_item(db: &Db, id: i64, key: &[u8; 32], dest_dir: &str) -> Result<String, String> {
    let (enc_path, enc_name) = {
        let conn = db.conn.lock();
        conn.query_row(
            "SELECT enc_path, enc_name FROM vault_items WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, row_bytes(r, 1))),
        )
        .map_err(|e| e.to_string())?
    };
    let blob = std::fs::read(&enc_path).map_err(|e| e.to_string())?;
    let plain = crypto::decrypt_with_key(&blob, key)?;
    let orig = crypto::decrypt_with_key(&enc_name, key)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .filter(|s| !s.contains(['\\', '/']) && !s.contains(".."))
        .unwrap_or_else(|| format!("vault-{}", id));
    // 名称无扩展名（旧版迁移条目）→ 按内容魔数补全，系统才能直接选对默认打开程序
    let orig = ensure_ext(&orig, &plain);
    // 导出目录必须存在（首次打开时 %TEMP%/filefly-vault 尚未创建，fs::write 会报 os error 3）
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("创建导出目录失败：{}", e))?;
    let dest = std::path::Path::new(dest_dir).join(&orig);
    std::fs::write(&dest, &plain).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

pub fn remove_item(db: &Db, id: i64) -> Result<(), String> {
    let conn = db.conn.lock();
    let enc_path: String = conn
        .query_row("SELECT enc_path FROM vault_items WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);
    let _ = std::fs::remove_file(&enc_path);
    db.conn.lock().execute("DELETE FROM vault_items WHERE id = ?1", params![id]).map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItem {
    pub id: i64,
    pub name: String,
    pub enc_path: String,
    pub added_at: i64,
}

fn uuid_like() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..16).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

#[cfg(test)]
mod change_pw_tests {
    use super::*;
    use crate::vault::crypto;

    /// 改密回环：创建 → 主密钥加密 2 条目 → 改密 → 旧密码失效 / 新密码可解锁 / 条目可解密打开
    #[test]
    fn change_password_roundtrip() {
        let base = std::env::temp_dir().join(format!("ff-cpw-test-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let db = Db::open(base.join("t.db")).unwrap();

        create(&db, "old-password", None, "").unwrap();
        let key = match unlock(&db, "old-password").unwrap() {
            VaultState::Unlocked { key } => key,
            _ => panic!("unlock"),
        };
        // 直接以主密钥加密两个条目（绕过 add_item 的全局 vault_dir，测试完全隔离）
        let mk = |name: &str, data: &[u8]| {
            let enc_name = crypto::encrypt_with_key(name.as_bytes(), &key).unwrap();
            let blob = crypto::encrypt_with_key(data, &key).unwrap();
            let p = base.join(format!("{}.ffb", name));
            std::fs::write(&p, &blob).unwrap();
            (p.to_string_lossy().to_string(), enc_name)
        };
        let (p1, n1) = mk("sample1.txt", b"hello vault 1");
        let (p2, n2) = mk("sample2.txt", b"hello vault 2");
        db.conn.lock().execute("INSERT INTO vault_items(enc_name, enc_path, added_at) VALUES(?1,?2,strftime('%s','now'))", params![n1, p1]).unwrap();
        db.conn.lock().execute("INSERT INTO vault_items(enc_name, enc_path, added_at) VALUES(?1,?2,strftime('%s','now'))", params![n2, p2]).unwrap();

        // 改密：2 条全部重加密
        let n = change_master_password(&db, "old-password", "new-password").unwrap();
        assert_eq!(n, 2);

        // 旧密码失效；新密码可解锁
        assert!(unlock(&db, "old-password").is_err());
        let key2 = match unlock(&db, "new-password").unwrap() {
            VaultState::Unlocked { key } => key,
            _ => panic!("relock"),
        };

        // 条目名称可解、内容可解密打开
        let items = list_items(&db, &key2).unwrap();
        assert_eq!(items.len(), 2);
        let s1 = items.iter().find(|i| i.name == "sample1.txt").expect("sample1 visible");
        let out = open_item(&db, s1.id, &key2, base.to_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), b"hello vault 1");

        // 错误旧密码改密必须失败，且不破坏数据
        assert!(change_master_password(&db, "wrong-password", "another-pass").is_err());
        let k3 = match unlock(&db, "new-password").unwrap() {
            VaultState::Unlocked { key } => key,
            _ => panic!("after-fail"),
        };
        assert_eq!(list_items(&db, &k3).unwrap().len(), 2);

        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod open_item_tests {
    use super::*;
    use crate::vault::crypto;

    /// 打开条目：导出目录不存在时应自动创建（修复 os error 3）
    #[test]
    fn open_item_creates_missing_dest_dir() {
        let base = std::env::temp_dir().join(format!("ff-open-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let db = Db::open(base.join("t.db")).unwrap();

        create(&db, "test-password", None, "").unwrap();
        let key = match unlock(&db, "test-password").unwrap() {
            VaultState::Unlocked { key } => key,
            _ => panic!("unlock"),
        };
        let enc_name = crypto::encrypt_with_key(b"note.txt", &key).unwrap();
        let blob = crypto::encrypt_with_key(b"hello", &key).unwrap();
        let p = base.join("a.ffb");
        std::fs::write(&p, &blob).unwrap();
        db.conn.lock().execute(
            "INSERT INTO vault_items(enc_name, enc_path, added_at) VALUES(?1,?2,strftime('%s','now'))",
            params![enc_name, p.to_string_lossy()],
        ).unwrap();

        // 导出目录 base/export 不存在 → 应自动创建并成功导出
        let dest_dir = base.join("export").join("nested");
        let out = open_item(&db, 1, &key, dest_dir.to_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), b"hello");
        assert!(out.ends_with("note.txt"));

        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod sniff_tests {
    use super::*;
    use crate::vault::crypto;

    /// 魔数识别基本断言
    #[test]
    fn sniff_ext_basics() {
        assert_eq!(sniff_ext(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]), Some("png"));
        assert_eq!(sniff_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(sniff_ext(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(sniff_ext(b"hello world"), Some("txt"));
        assert_eq!(sniff_ext(&[0x00, 0x01, 0x02, 0x03]), None);
        // OOXML：zip 容器内含 word/ 特征 → docx
        let mut docx_like = b"PK\x03\x04".to_vec();
        docx_like.extend_from_slice(b"....word/document.xml....");
        assert_eq!(sniff_ext(&docx_like), Some("docx"));
    }

    /// 已迁移条目（无扩展名）解锁后自动按内容补全类型；open_item 导出也带扩展名
    #[test]
    fn complete_legacy_names_appends_ext() {
        let base = std::env::temp_dir().join(format!("ff-sniff-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let db = Db::open(base.join("t.db")).unwrap();

        create(&db, "test-password", None, "").unwrap();
        let key = match unlock(&db, "test-password").unwrap() {
            VaultState::Unlocked { key } => key,
            _ => panic!("unlock"),
        };
        // 模拟两条已迁移条目：名称无扩展名，内容分别为 PNG / 纯文本
        let mk = |name: &str, data: &[u8]| {
            let enc_name = crypto::encrypt_with_key(name.as_bytes(), &key).unwrap();
            let blob = crypto::encrypt_with_key(data, &key).unwrap();
            let p = base.join(format!("{}.ffb", uuid_like()));
            std::fs::write(&p, &blob).unwrap();
            (p.to_string_lossy().to_string(), enc_name)
        };
        let png_bytes = vec![0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        let (p1, n1) = mk("已迁移_b229700e", &png_bytes);
        let (p2, n2) = mk("已迁移_da2b44f5", "普通文本内容\n第二行\n".as_bytes());
        db.conn.lock().execute("INSERT INTO vault_items(enc_name, enc_path, added_at) VALUES(?1,?2,strftime('%s','now'))", params![n1, p1]).unwrap();
        db.conn.lock().execute("INSERT INTO vault_items(enc_name, enc_path, added_at) VALUES(?1,?2,strftime('%s','now'))", params![n2, p2]).unwrap();

        // 补全：两条都应识别成功
        let fixed = complete_legacy_names(&db, &key);
        assert_eq!(fixed, 2);

        let names: Vec<String> = list_items(&db, &key).unwrap().into_iter().map(|i| i.name).collect();
        assert!(names.iter().any(|n| n == "已迁移_b229700e.png"), "实际: {:?}", names);
        assert!(names.iter().any(|n| n == "已迁移_da2b44f5.txt"), "实际: {:?}", names);

        // 幂等：再跑一次应为 0
        assert_eq!(complete_legacy_names(&db, &key), 0);

        // open_item 兜底：即使名称仍无扩展名，导出文件也按内容补全
        let conn = db.conn.lock();
        let id: i64 = conn.query_row("SELECT MIN(id) FROM vault_items", [], |r| r.get(0)).unwrap();
        drop(conn);
        let out = open_item(&db, id, &key, base.join("export").to_str().unwrap()).unwrap();
        assert!(std::path::Path::new(&out).extension().is_some(), "导出文件必须有扩展名: {}", out);

        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod second_pw_tests {
    use super::*;

    /// 第二道密码生命周期：设置 → 验证通过/错误拒绝 → 修改 → 清除后恒通过
    #[test]
    fn set_second_password_lifecycle() {
        let base = std::env::temp_dir().join(format!("ff-sec-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let db = Db::open(base.join("t.db")).unwrap();

        create(&db, "master-password", None, "").unwrap(); // 创建时不设第二道密码

        // 未设置时任何密码都返回 true（门锁不存在）
        assert!(verify_second(&db, "anything"));

        // 设置
        set_second_password(&db, Some("second-123")).unwrap();
        assert!(verify_second(&db, "second-123"));
        assert!(!verify_second(&db, "wrong-second"));
        assert!(!verify_second(&db, "master-password")); // 与主密码无关，独立验证

        // 修改
        set_second_password(&db, Some("second-456")).unwrap();
        assert!(verify_second(&db, "second-456"));
        assert!(!verify_second(&db, "second-123"));

        // 清除
        set_second_password(&db, None).unwrap();
        assert!(verify_second(&db, "anything"));
        // 空串等价清除
        set_second_password(&db, Some("second-789")).unwrap();
        set_second_password(&db, Some("")).unwrap();
        assert!(verify_second(&db, "anything"));

        // 短密码拒绝
        assert!(set_second_password(&db, Some("123")).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}
