// vault 命令层（F-23~F-25）
use tauri::State;
type S<'a> = State<'a, crate::AppState>;

#[tauri::command]
pub async fn vault_status(state: S<'_>) -> Result<crate::vault::box_::VaultStatus, String> {
    let state_inner = state.inner();
    let v = state_inner.vault.lock().clone();
    Ok(crate::vault::box_::status(&state_inner.db, &v))
}

/// 创建：主密码 + 可选第二道密码 + 提示；返回 24 词恢复密钥（仅创建时展示一次，F-25）
#[tauri::command]
pub async fn vault_create(
    master_password: String,
    second_password: Option<String>,
    hint: Option<String>,
    state: S<'_>,
) -> Result<Vec<String>, String> {
    let db = state.db.clone();
    let words = crate::vault::box_::create(&db, &master_password, second_password.as_deref(), hint.as_deref().unwrap_or(""))?;
    // 记录恢复密钥校验值（settings）
    let verifier = crate::vault::crypto::recovery_key_hash(&words);
    let _ = db.conn.lock().execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES('recovery_verifier', ?1)",
        rusqlite::params![serde_json::to_string(&verifier.to_vec()).unwrap()],
    );
    *state.vault.lock() = crate::vault::box_::VaultState::Locked;
    Ok(words)
}

#[tauri::command]
pub async fn vault_unlock(password: String, state: S<'_>) -> Result<bool, String> {
    let db = state.db.clone();
    let vs = crate::vault::box_::unlock(&db, &password)?;
    // 顺手迁移旧版条目（旧条目以「存入时输入的密码」加密；若恰为主密码则自动重加密为主密钥格式）
    if let crate::vault::box_::VaultState::Unlocked { key } = &vs {
        let key = *key;
        let db2 = db.clone();
        let pw = password.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            crate::vault::box_::migrate_legacy(&db2, &pw, &key);
            // 幂等补全：早期迁移条目名称无扩展名 → 按内容魔数识别类型写入（打开时才能选对默认程序）
            crate::vault::box_::complete_legacy_names(&db2, &key)
        }).await;
    }
    *state.vault.lock() = vs;
    Ok(true)
}

/// 设置/修改/清除第二道密码（需解锁态；new_second 传 None/空 = 清除）。
/// 第二道密码不参与内容加密，设置/修改无需重加密条目。
#[tauri::command]
pub async fn vault_set_second(new_second: Option<String>, state: S<'_>) -> Result<(), String> {
    let unlocked = matches!(*state.vault.lock(), crate::vault::box_::VaultState::Unlocked { .. });
    if !unlocked {
        return Err("VAULT_LOCKED".into());
    }
    let db = state.db.clone();
    crate::vault::box_::set_second_password(&db, new_second.as_deref())
}

/// 恢复密钥重置主密码（F-25）
#[tauri::command]
pub async fn vault_recover(words: Vec<String>, new_password: String, state: S<'_>) -> Result<Vec<String>, String> {
    let db = state.db.clone();
    crate::vault::box_::recover_reset(&db, &words, &new_password)
}

/// 修改主密码：校验旧密码 → 全部条目重加密 → 更新盐/校验值（需已解锁或提供正确的旧密码）
#[tauri::command]
pub async fn vault_change_password(old_password: String, new_password: String, state: S<'_>) -> Result<usize, String> {
    let db = state.db.clone();
    let new_pw = new_password.clone();
    let n = tauri::async_runtime::spawn_blocking(move || {
        crate::vault::box_::change_master_password(&db, &old_password, &new_pw)
    })
    .await
    .map_err(|e| e.to_string())??;
    // 成功后以新密码重新派生密钥，保持解锁态
    let db = state.db.clone();
    let vs = crate::vault::box_::unlock(&db, &new_password)?;
    *state.vault.lock() = vs;
    Ok(n)
}

#[tauri::command]
pub async fn vault_lock(state: S<'_>) -> Result<(), String> {
    let mut v = state.vault.lock();
    if let crate::vault::box_::VaultState::Unlocked { key } = v.clone() {
        let mut k = key;
        use zeroize::Zeroize;
        k.zeroize();
    }
    *v = crate::vault::box_::VaultState::Locked;
    Ok(())
}

#[tauri::command]
pub async fn vault_list(state: S<'_>) -> Result<Vec<crate::vault::box_::VaultItem>, String> {
    // 仅解锁态可浏览（F-23），用主密钥解密名称
    let key = {
        let v = state.vault.lock();
        match &*v {
            crate::vault::box_::VaultState::Unlocked { key } => *key,
            _ => return Err("VAULT_LOCKED".into()),
        }
    };
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || crate::vault::box_::list_items(&db, &key))
        .await
        .map_err(|e| e.to_string())?
}

/// 收入保险箱（加密移入）：需已解锁；返回 (成功数, 失败明细)；目录与不存在路径自动跳过
#[tauri::command]
pub async fn vault_add(paths: Vec<String>, state: S<'_>) -> Result<(usize, Vec<String>), String> {
    let key = {
        let v = state.vault.lock();
        match &*v {
            crate::vault::box_::VaultState::Unlocked { key } => *key,
            _ => return Err("VAULT_LOCKED".into()),
        }
    };
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut n = 0usize;
        let mut errs: Vec<String> = Vec::new();
        for p in paths {
            let path = std::path::Path::new(&p);
            if !path.is_file() {
                errs.push(format!("{}：仅支持文件（目录已跳过）", p.split(['\\', '/']).last().unwrap_or(&p)));
                continue;
            }
            match crate::vault::box_::add_item(&db, &p, &key) {
                Ok(()) => n += 1,
                Err(e) => errs.push(format!("{}：{}", p.split(['\\', '/']).last().unwrap_or(&p), e)),
            }
        }
        Ok((n, errs))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vault_remove(id: i64, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || crate::vault::box_::remove_item(&db, id))
        .await
        .map_err(|e| e.to_string())?
}

/// 移出还原（0.1.9）：解密写回存入时的原始位置，成功后删除密文条目；返回还原后的实际路径
#[tauri::command]
pub async fn vault_restore(id: i64, state: S<'_>) -> Result<String, String> {
    let key = {
        let v = state.vault.lock();
        match &*v {
            crate::vault::box_::VaultState::Unlocked { key } => *key,
            _ => return Err("VAULT_LOCKED".into()),
        }
    };
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || crate::vault::box_::restore_item(&db, id, &key))
        .await
        .map_err(|e| e.to_string())?
}

/// 打开条目：解密导出到临时目录（解锁后，用主密钥），返回导出文件路径
#[tauri::command]
pub async fn vault_open(id: i64, state: S<'_>) -> Result<String, String> {
    let key = {
        let v = state.vault.lock();
        match &*v {
            crate::vault::box_::VaultState::Unlocked { key } => *key,
            _ => return Err("VAULT_LOCKED".into()),
        }
    };
    let db = state.db.clone();
    let tmp = std::env::temp_dir().join("filefly-vault");
    tauri::async_runtime::spawn_blocking(move || crate::vault::box_::open_item(&db, id, &key, &tmp.to_string_lossy()))
        .await
        .map_err(|e| e.to_string())?
}

/// 第二道密码校验（浏览敏感条目，F-24）
#[tauri::command]
pub async fn vault_verify_second(password: String, state: S<'_>) -> Result<bool, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(crate::vault::box_::verify_second(&db, &password)))
        .await
        .map_err(|e| e.to_string())?
}
