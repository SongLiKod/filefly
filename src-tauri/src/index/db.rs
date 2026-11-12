// SQLite + FTS5 schema 与查询计划（技术文档 §4.1）
use parking_lot::Mutex;
use rusqlite::Connection;
use std::sync::Arc;

#[derive(Clone)]
pub struct Db {
    pub conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: std::path::PathBuf) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Self::migrate(&conn)?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    fn migrate(conn: &Connection) -> anyhow::Result<()> {
        // —— 搜索索引表（技术文档 §4.1：volume/frn/parent_frn/name/拼音/拼音首字母）——
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS files(
              volume_id INTEGER NOT NULL,
              frn       INTEGER NOT NULL,
              parent_frn INTEGER NOT NULL,
              name      TEXT NOT NULL,
              name_py   TEXT NOT NULL DEFAULT '',
              name_py_initial TEXT NOT NULL DEFAULT '',
              ext       TEXT,
              size      INTEGER DEFAULT 0,
              mtime     INTEGER DEFAULT 0,
              is_dir    INTEGER DEFAULT 0,
              path      TEXT UNIQUE
            );
            CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
            CREATE INDEX IF NOT EXISTS idx_files_volume_frn ON files(volume_id, frn);
            CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
            CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
            CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);

            CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
              name, name_py, name_py_initial,
              content='files', content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
              INSERT INTO files_fts(rowid, name, name_py, name_py_initial)
              VALUES (new.rowid, new.name, new.name_py, new.name_py_initial);
            END;
            CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
              INSERT INTO files_fts(files_fts, rowid, name, name_py, name_py_initial)
              VALUES ('delete', old.rowid, old.name, old.name_py, old.name_py_initial);
            END;
            CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
              INSERT INTO files_fts(files_fts, rowid, name, name_py, name_py_initial)
              VALUES ('delete', old.rowid, old.name, old.name_py, old.name_py_initial);
              INSERT INTO files_fts(rowid, name, name_py, name_py_initial)
              VALUES (new.rowid, new.name, new.name_py, new.name_py_initial);
            END;

            CREATE TABLE IF NOT EXISTS volumes(
              id INTEGER PRIMARY KEY,
              root TEXT NOT NULL,
              fs TEXT DEFAULT '',
              last_usn INTEGER DEFAULT 0
            );

            -- 标签双写（技术文档 §5.1）
            CREATE TABLE IF NOT EXISTS tag_defs(
              name TEXT PRIMARY KEY,
              color TEXT NOT NULL,
              sort INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS file_tags(
              path TEXT NOT NULL,
              tag TEXT NOT NULL,
              created_at INTEGER,
              PRIMARY KEY(path, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag);
            CREATE TABLE IF NOT EXISTS tag_rules(
              tag TEXT PRIMARY KEY,
              dest_dir TEXT NOT NULL
            );

            -- 最近使用（F-22）
            CREATE TABLE IF NOT EXISTS recent_items(
              path TEXT PRIMARY KEY,
              kind TEXT DEFAULT 'file',   -- file | location
              opened_at INTEGER NOT NULL
            );

            -- 设置（应用级）
            CREATE TABLE IF NOT EXISTS settings(
              key TEXT PRIMARY KEY,
              value TEXT
            );

            -- 保险箱元数据（技术文档 §7）
            CREATE TABLE IF NOT EXISTS vault_meta(
              id INTEGER PRIMARY KEY CHECK (id = 1),
              kdf_salt BLOB NOT NULL,
              verifier BLOB NOT NULL,
              second_salt BLOB,
              second_verifier BLOB,
              hint TEXT DEFAULT '',
              created_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS vault_items(
              id INTEGER PRIMARY KEY,
              enc_name BLOB NOT NULL,
              enc_path BLOB NOT NULL,
              enc_orig_path BLOB,
              added_at INTEGER
            );

            -- 搜索埋点（验收口径 §10：本地统计，不上传内容）
            CREATE TABLE IF NOT EXISTS search_stats(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              q TEXT,
              took_us INTEGER,
              hit_count INTEGER,
              at INTEGER
            );
            "#,
        )?;
        // 预置 8 色标签（主题 §8.5）
        conn.execute_batch(
            r#"
            INSERT OR IGNORE INTO tag_defs(name, color, sort) VALUES
              ('红', '#E5484D', 1), ('橙', '#F76B15', 2), ('黄', '#FFC53D', 3), ('绿', '#46A758', 4),
              ('青', '#00B8C4', 5), ('蓝', '#2E6BE6', 6), ('紫', '#8E4EC6', 7), ('灰', '#8B8D98', 8);
            "#,
        )?;
        // 旧库迁移：vault_items 补 enc_orig_path 列（移出到原位置功能，0.1.9）；
        // 已有该列时 ALTER 报 duplicate column，忽略即可（幂等）
        let _ = conn.execute_batch("ALTER TABLE vault_items ADD COLUMN enc_orig_path BLOB;");
        Ok(())
    }

    /// FTS5 MATCH + WHERE 组合查询（Rust 侧生成 SQL，技术文档 §4.3）
    /// QueryAST: { text, py_initial, ext, min_size, max_size, mtime_after, tag }
    pub fn search(&self, ast: &QueryAst, limit: usize) -> anyhow::Result<Vec<SearchHit>> {
        let conn = self.conn.lock();
        let mut sql = String::from(
            "SELECT f.name, f.path, f.size, f.mtime, f.is_dir, f.ext
             FROM files f ",
        );
        let mut where_clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if !ast.text.is_empty() {
            // 子串匹配：名称 / 拼音 / 拼音首字母，多词 AND。
            // 不用 FTS5 MATCH：unicode61 分词器不切中文（"项目计划"是单 token，
            // 搜"计划"匹配不上），INSTR 子串语义才符合文件搜索直觉。
            for term in ast.text.split_whitespace() {
                let t: String = term.chars().filter(|c| *c != '%' && *c != '_').collect();
                if t.is_empty() { continue; }
                params.push(Box::new(format!("%{}%", t.to_lowercase())));
                let n = params.len();
                where_clauses.push(format!(
                    "(INSTR(LOWER(f.name), ?{n}) > 0 OR INSTR(f.name_py, ?{n}) > 0 OR INSTR(f.name_py_initial, ?{n}) > 0)"
                ));
            }
        }
        if let Some(ext) = &ast.ext {
            params.push(Box::new(ext.clone()));
            let n = params.len();
            where_clauses.push(format!("LOWER(f.ext) = LOWER(?{n})"));
        }
        if let Some(s) = ast.min_size {
            params.push(Box::new(s as i64));
            where_clauses.push(format!("f.size >= ?{}", params.len()));
        }
        if let Some(s) = ast.max_size {
            params.push(Box::new(s as i64));
            where_clauses.push(format!("f.size <= ?{}", params.len()));
        }
        if let Some(t) = ast.mtime_after {
            params.push(Box::new(t));
            where_clauses.push(format!("f.mtime >= ?{}", params.len()));
        }
        if let Some(d) = ast.is_dir {
            params.push(Box::new(d as i64));
            where_clauses.push(format!("f.is_dir = ?{}", params.len()));
        }
        if !where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&where_clauses.join(" AND "));
        }
        // 相关度/日期排序（F-12）
        sql.push_str(&format!(" ORDER BY f.mtime DESC LIMIT {}", limit.min(2000)));

        let mut stmt = conn.prepare(&sql)?;
        let rows = {
            let mut q = stmt.query(rusqlite::params_from_iter(params.iter().map(|b| b.as_ref())))?;
            let mut out = Vec::new();
            while let Ok(Some(r)) = q.next() {
                out.push(SearchHit {
                    name: r.get(0)?,
                    path: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    size: r.get(2).unwrap_or(0),
                    mtime: r.get(3)?,
                    is_dir: r.get::<_, i64>(4)? != 0,
                    ext: r.get(5).ok(),
                });
            }
            out
        };
        Ok(rows)
    }
}

#[derive(Debug, Default, Clone)]
pub struct QueryAst {
    pub text: String,
    pub fts_match: String,
    pub ext: Option<String>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub mtime_after: Option<i64>,
    pub is_dir: Option<bool>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub name: String,
    pub path: String,
    pub size: i64,
    pub mtime: i64,
    pub is_dir: bool,
    pub ext: Option<String>,
}
