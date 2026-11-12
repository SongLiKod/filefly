// AES-256-GCM 加解密 + Argon2id 派生（技术文档 §7，不用自造加密轮子）
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

/// KDF 参数：m=64MB, t=3, p=4（可配置），盐 16B 随机
pub const KDF_M_KIB: u32 = 64 * 1024;
pub const KDF_T: u32 = 3;
pub const KDF_P: u32 = 4;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12; // 每文件独立 12B nonce（随机）
pub const MAGIC: [u8; 4] = [0xFF, b'V', b'B', b'1']; // [magic FFVB1]

pub fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let params = Params::new(KDF_M_KIB, KDF_T, KDF_P, Some(32)).expect("kdf params");
    let a2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    a2.hash_password_into(password.as_bytes(), salt, &mut key).expect("argon2id");
    key
}

/// 主密码校验值：KDF 输出再 SHA-256 截断存储（防误输，不存原密）
pub fn verifier_of(key: &[u8; 32]) -> [u8; 16] {
    let h = Sha256::digest(key);
    let mut v = [0u8; 16];
    v.copy_from_slice(&h[..16]);
    v
}

/// 单文件加密：密文格式 [magic FFVB1][salt 16B][nonce 12B][ciphertext][tag]
pub fn encrypt_bytes(plain: &[u8], key: &[u8; 32], salt: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::generic_array::GenericArray;
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|_| "encrypt failed")?;
    let mut out = Vec::with_capacity(MAGIC.len() + SALT_LEN + NONCE_LEN + ct.len());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// 单文件解密（密钥驻内存，不落盘）
pub fn decrypt_bytes(blob: &[u8], password: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::generic_array::GenericArray;
    if blob.len() < MAGIC.len() + SALT_LEN + NONCE_LEN || &blob[..4] != &MAGIC {
        return Err("INVALID_BLOB: 非本应用密文或已损坏".into());
    }
    let salt = &blob[4..4 + SALT_LEN];
    let nonce = &blob[4 + SALT_LEN..4 + SALT_LEN + NONCE_LEN];
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new(GenericArray::from_slice(&key));
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), &blob[4 + SALT_LEN + NONCE_LEN..])
        .map_err(|_| "DECRYPT_FAILED: 密码错误或文件已损坏".into());
    let mut key_zero = key;
    key_zero.zeroize(); // 用后清零
    plain
}

/// 用已有密钥直接加密（保险箱条目：解锁后密钥驻内存，无需再次派生）
/// 格式与 encrypt_bytes 兼容：[magic FFVB1][salt 16B 占位零][nonce 12B][ciphertext][tag]
pub fn encrypt_with_key(plain: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let salt = [0u8; SALT_LEN];
    encrypt_bytes(plain, key, &salt)
}

/// 用已有密钥直接解密（与 encrypt_with_key 配对）
pub fn decrypt_with_key(blob: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::generic_array::GenericArray;
    if blob.len() < MAGIC.len() + SALT_LEN + NONCE_LEN || &blob[..4] != &MAGIC {
        return Err("INVALID_BLOB: 非本应用密文或已损坏".into());
    }
    let nonce = &blob[4 + SALT_LEN..4 + SALT_LEN + NONCE_LEN];
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), &blob[4 + SALT_LEN + NONCE_LEN..])
        .map_err(|_| "DECRYPT_FAILED: 密钥不匹配或文件已损坏".into())
}

/// 24 词恢复密钥（BIP39 词表，仅创建时展示一次）
pub fn generate_recovery_key() -> Vec<String> {
    // 内置精简 BIP39 英文词表抽样实现；正式版嵌入完整 2048 词表
    const WORDS: &[&str] = &[
        "abandon", "ability", "absorb", "accent", "access", "acid", "across", "act", "action",
        "admit", "adult", "advice", "afraid", "agent", "air", "alarm", "album", "alert", "alien",
        "alive", "allow", "alone", "alpha", "amber", "anchor", "angle", "animal", "answer",
        "apple", "april", "arcade", "arctic", "argue", "armor", "arrow", "artist", "aspect",
        "atlas", "atom", "audio", "author", "autumn", "avocado", "awake", "axis", "bacon",
        "badge", "balcony", "bamboo", "banner", "basket", "beacon", "beach", "bicycle", "binary",
        "birch", "bitter", "blade", "blanket", "blossom", "boulder", "brave", "breeze", "bridge",
        "bright", "bronze", "bubble", "buffalo", "cabin", "cactus", "camera", "canyon", "canvas",
        "carbon", "castle", "cattle", "cavern", "cedar", "chalk", "cherry", "chorus", "cinder",
        "circle", "citrus", "clarion", "cliff", "cloud", "clover", "cobalt", "comet", "copper",
        "coral", "cosmos", "cotton", "cradle", "crater", "crimson", "cactus", "crystal", "cyclone",
        "dahlia", "daisy", "dawn", "delta", "desert", "diamond", "dolphin", "domino", "dragon",
        "dune", "eagle", "ember", "falcon", "feather", "fern", "flint", "forest", "fossil",
        "garnet", "glacier", "granite", "harbor", "heron", "iceberg", "ivory", "jasmine", "jungle",
        "kite", "lagoon", "lantern", "lotus", "lunar", "mango", "maple", "marble", "meadow",
        "meteor", "mirage", "mosaic", "nebula", "noble", "oasis", "obsidian", "ocean", "orbit",
        "orchid", "otter", "panda", "pebble", "phoenix", "pilot", "pine", "plasma", "prism",
        "quartz", "quasar", "raven", "reef", "ripple", "river", "rocket", "saffron", "sage",
        "sailor", "sand", "sapphire", "shadow", "signal", "silver", "sky", "snow", "solar",
        "spiral", "spruce", "stellar", "stone", "storm", "summit", "talon", "tempest", "thunder",
        "tiger", "timber", "topaz", "torch", "tundra", "twilight", "valley", "vertex", "violet",
        "voyage", "walnut", "water", "whisper", "willow", "window", "wolf", "zenith", "zephyr",
    ];
    let mut rng = rand::thread_rng();
    (0..24).map(|_| WORDS[rng.next_u32() as usize % WORDS.len()].to_string()).collect()
}

pub fn recovery_key_hash(words: &[String]) -> [u8; 16] {
    let joined = words.join(" ");
    let mut key = derive_key(&joined, b"FileFly.Recovery");
    let v = verifier_of(&key);
    key.zeroize();
    v
}
