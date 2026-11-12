// 保险箱 UI（F-23~F-25：全屏解锁卡、创建、恢复密钥、条目管理、双重密码）
import React, { useEffect, useState } from "react";
import { api } from "@/ipc/client";
import type { VaultItem, VaultStatus } from "@/ipc/types";
import { fmtDate } from "@/ipc/types";
import { Icons } from "@/components/Icons";
import { alertDialog, confirmDialog, promptDialog } from "@/components/dialog";

export const VaultView: React.FC = () => {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [itemsErr, setItemsErr] = useState("");
  const [password, setPassword] = useState("");
  const [second, setSecond] = useState("");
  const [hint, setHint] = useState("");
  const [words, setWords] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [unlockFailCount, setUnlockFailCount] = useState(0); // F-24 失败次数限制
  const [lockedUntil, setLockedUntil] = useState(0);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverWords, setRecoverWords] = useState("");
  // 修改主密码（已解锁态）
  const [showChangePw, setShowChangePw] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [changeErr, setChangeErr] = useState("");
  const [changing, setChanging] = useState(false);
  // 第二道密码管理（已解锁态）：设置 / 修改 / 清除
  const [showSecond, setShowSecond] = useState(false);
  const [secCur, setSecCur] = useState("");
  const [secNew, setSecNew] = useState("");
  const [secNew2, setSecNew2] = useState("");
  const [secErr, setSecErr] = useState("");
  const [secBusy, setSecBusy] = useState(false);

  const refresh = async () => {
    const s = await api.vaultStatus();
    setStatus(s);
    setItemsErr("");
    if (!s.locked && s.created) {
      try { setItems(await api.vaultList()); } catch (e) { setItems([]); setItemsErr(String(e).replace(/^Error: /, "")); }
    }
  };
  useEffect(() => { refresh(); }, []);

  // 本地校验第二道密码（IPC 异步，统一 await 使用）
  const verifySecondLocal = async (pw: string): Promise<boolean> => {
    if (!pw) return false;
    try { return await api.vaultVerifySecond(pw); } catch { return false; }
  };

  if (!status) return <div style={{ padding: 40 }}>加载中…</div>;

  // —— 未创建：创建向导 ——
  if (!status.created) {
    return (
      <VaultShell>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><Icons.Lock /> 创建保险箱</h2>
        <p style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>
          AES-256-GCM 本地加密 · Argon2id 密码派生 · 文件在磁盘上始终为密文
        </p>
        <Field label="主密码（至少 6 位）"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} /></Field>
        <Field label="第二道密码（可选，双重保护）"><input type="password" value={second} onChange={(e) => setSecond(e.target.value)} style={inputStyle} /></Field>
        <Field label="密码提示（可选）"><input value={hint} onChange={(e) => setHint(e.target.value)} style={inputStyle} /></Field>
        {error && <ErrorText>{error}</ErrorText>}
        <button className="btn-primary" style={{ width: "100%" }} onClick={async () => {
          try {
            const w = await api.vaultCreate(password, second || undefined, hint || undefined);
            setWords(w);
            setError("");
          } catch (e) { setError(String(e).replace(/^Error: /, "")); }
        }}>创建并生成恢复密钥</button>

        {words && (
          <div style={{ marginTop: 16, background: "var(--ff-bg-selected)", borderRadius: 8, padding: 14 }}>
            <strong style={{ fontSize: 13, color: "var(--ff-warning)" }}>⚠ 24 词恢复密钥（仅此一次展示，无法暴力找回）</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 10, fontSize: 13, fontFamily: "monospace" }}>
              {words.map((w, i) => <span key={i}>{i + 1}. {w}</span>)}
            </div>
            <button className="btn-primary" style={{ marginTop: 12, width: "100%" }}
              onClick={async () => { await api.vaultUnlock(password); setWords(null); await refresh(); }}>
              我已抄写，进入保险箱
            </button>
          </div>
        )}
      </VaultShell>
    );
  }

  // —— 锁定：解锁卡（同 NanoFile 布局，Fly Blue 主按钮，技术文档 §9）——
  if (status.locked) {
    const now = Date.now();
    const locked = now < lockedUntil;
    return (
      <VaultShell>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, margin: "0 auto 10px", borderRadius: 14, background: "var(--ff-bg-selected)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Lock size={26} />
          </div>
          <h2 style={{ margin: 0 }}>保险箱已锁定</h2>
          {status.hint && <p style={{ color: "var(--ff-text-secondary)", fontSize: 12 }}>提示：{status.hint}</p>}
        </div>
        <input type="password" placeholder="主密码" value={password} disabled={locked}
          onChange={(e) => setPassword(e.target.value)} style={inputStyle}
          onKeyDown={async (e) => {
            if (e.key !== "Enter" || locked) return;
            try {
              await api.vaultUnlock(password);
              if (status.hasSecondPassword) {
                const ok = await api.vaultVerifySecond(second);
                if (!ok) throw new Error("SECOND_WRONG");
              }
              setUnlockFailCount(0); setPassword(""); setSecond("");
              await refresh();
            } catch {
              const n = unlockFailCount + 1;
              setUnlockFailCount(n);
              setError(`密码错误（${n}/5）`);
              if (n >= 5) setLockedUntil(Date.now() + 60_000); // 失败 5 次锁定 60s（F-24）
            }
          }} />
        {status.hasSecondPassword && (
          <input type="password" placeholder="第二道密码" value={second} onChange={(e) => setSecond(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
        )}
        {error && <ErrorText>{error}</ErrorText>}
        {locked && <ErrorText>失败次数过多，请等待 {Math.ceil((lockedUntil - Date.now()) / 1000)}s</ErrorText>}
        <button className="btn-primary" style={{ width: "100%" }} disabled={locked}
          onClick={async () => {
            try {
              await api.vaultUnlock(password);
              // 第二道密码已设置时必须同时验证通过（此前结果被忽略，输错也能解锁——已修复）
              if (status.hasSecondPassword) {
                const ok = await api.vaultVerifySecond(second);
                if (!ok) throw new Error("SECOND_WRONG");
              }
              setUnlockFailCount(0); setPassword(""); setSecond("");
              await refresh();
            } catch {
              const n = unlockFailCount + 1;
              setUnlockFailCount(n);
              setError(`密码错误（${n}/5）`);
              if (n >= 5) setLockedUntil(Date.now() + 60_000);
            }
          }}>解锁</button>
        <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setShowRecover((v) => !v)}>
          {showRecover ? "返回解锁" : "忘记密码？用恢复密钥重置"}
        </button>
        {showRecover && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 12, color: "var(--ff-text-secondary)" }}>输入创建时保存的 24 词恢复密钥（空格分隔）。明确边界：<b>无法暴力找回</b>，仅恢复密钥可重置。</p>
            <textarea value={recoverWords} onChange={(e) => setRecoverWords(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: "monospace" }} />
            <button className="btn-primary" style={{ width: "100%", marginTop: 8 }} onClick={async () => {
              try {
                await api.vaultRecover(recoverWords.trim().split(/\s+/), password || "new-password-123");
                await refresh();
              } catch (e) { setError(String(e).replace(/^Error: /, "")); }
            }}>重置主密码</button>
          </div>
        )}
      </VaultShell>
    );
  }

  // —— 已解锁：条目管理 ——
  return (
    <VaultShell wide>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}><Icons.Lock /> 保险箱 · 已解锁</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={() => { setShowChangePw((v) => !v); setChangeErr(""); }}>
            修改密码
          </button>
          <button className="btn-ghost" onClick={async () => { await api.vaultLock(); await refresh(); }}>
            <Icons.Close size={12} /> 锁定
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--ff-text-secondary)", margin: "0 0 12px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span>密钥仅驻内存（mlock）· 文件在磁盘上始终为密文 · 共 {items.length} 项 · 第二道密码：{status.hasSecondPassword ? "已启用" : "未设置"}</span>
        <button className="btn-ghost" style={{ fontSize: 12, padding: "2px 10px" }}
          onClick={() => { setShowSecond((v) => !v); setSecErr(""); }}>
          {status.hasSecondPassword ? "修改/清除" : "设置"}
        </button>
      </p>

      {/* 第二道密码管理：独立于主密码的查看门锁（不参与加密，改动无需重加密） */}
      {showSecond && (
        <div style={{ background: "var(--ff-bg-selected)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>{status.hasSecondPassword ? "修改第二道密码" : "设置第二道密码"}</strong>
          <p style={{ fontSize: 12, color: "var(--ff-text-secondary)", margin: "4px 0 10px" }}>
            用途：打开/导出条目时需再次输入这道密码，防止他人借用你已解锁的电脑查看保险箱内容。它独立于主密码，修改主密码不影响它。
          </p>
          {status.hasSecondPassword && (
            <Field label="当前第二道密码"><input type="password" value={secCur} onChange={(e) => setSecCur(e.target.value)} style={inputStyle} /></Field>
          )}
          <Field label="新第二道密码（至少 6 位）"><input type="password" value={secNew} onChange={(e) => setSecNew(e.target.value)} style={inputStyle} /></Field>
          <Field label="确认新第二道密码"><input type="password" value={secNew2} onChange={(e) => setSecNew2(e.target.value)} style={inputStyle} /></Field>
          {secErr && <ErrorText>{secErr}</ErrorText>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={secBusy} onClick={async () => {
              setSecErr("");
              if (status.hasSecondPassword && !(await verifySecondLocal(secCur))) { setSecErr("当前第二道密码不正确"); return; }
              if (secNew.length < 6) { setSecErr("新第二道密码至少 6 位"); return; }
              if (secNew !== secNew2) { setSecErr("两次输入的新密码不一致"); return; }
              setSecBusy(true);
              try {
                await api.vaultSetSecond(secNew);
                setShowSecond(false); setSecCur(""); setSecNew(""); setSecNew2("");
                await alertDialog("设置成功", "第二道密码已更新。下次打开保险箱条目时需要输入它。", "success");
                await refresh();
              } catch (e) { setSecErr(String(e).replace(/^Error: /, "")); }
              finally { setSecBusy(false); }
            }}>{secBusy ? "保存中…" : status.hasSecondPassword ? "确认修改" : "确认设置"}</button>
            {status.hasSecondPassword && (
              <button className="btn-ghost" disabled={secBusy} onClick={async () => {
                setSecErr("");
                if (!(await verifySecondLocal(secCur))) { setSecErr("当前第二道密码不正确"); return; }
                const ok = await confirmDialog("清除第二道密码", "清除后打开条目将只需主密码解锁，确定清除吗？", { danger: true, confirmText: "清除" });
                if (!ok) return;
                setSecBusy(true);
                try {
                  await api.vaultSetSecond(undefined);
                  setShowSecond(false); setSecCur(""); setSecNew(""); setSecNew2("");
                  await refresh();
                } catch (e) { setSecErr(String(e).replace(/^Error: /, "")); }
                finally { setSecBusy(false); }
              }}>清除</button>
            )}
            <button className="btn-ghost" disabled={secBusy} onClick={() => { setShowSecond(false); setSecErr(""); }}>取消</button>
          </div>
        </div>
      )}

      {showChangePw && (
        <div style={{ background: "var(--ff-bg-selected)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>修改主密码</strong>
          <p style={{ fontSize: 12, color: "var(--ff-text-secondary)", margin: "4px 0 10px" }}>
            所有条目将立即用新密钥重新加密，第二道密码保持不变。过程无需重新导入文件。
          </p>
          <Field label="当前主密码"><input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} style={inputStyle} /></Field>
          <Field label="新主密码（至少 6 位）"><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={inputStyle} /></Field>
          <Field label="确认新主密码"><input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} style={inputStyle} /></Field>
          {changeErr && <ErrorText>{changeErr}</ErrorText>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={changing} onClick={async () => {
              setChangeErr("");
              if (newPw.length < 6) { setChangeErr("新主密码至少 6 位"); return; }
              if (newPw !== newPw2) { setChangeErr("两次输入的新密码不一致"); return; }
              setChanging(true);
              try {
                const n = await api.vaultChangePassword(oldPw, newPw);
                setShowChangePw(false); setOldPw(""); setNewPw(""); setNewPw2("");
                await alertDialog("修改成功", `主密码已更新，${n} 个条目已用新密钥重新加密。请牢记新密码。`, "success");
                await refresh();
              } catch (e) {
                setChangeErr(String(e).replace(/^Error: /, ""));
              } finally { setChanging(false); }
            }}>{changing ? "正在重加密…" : "确认修改"}</button>
            <button className="btn-ghost" disabled={changing} onClick={() => { setShowChangePw(false); setChangeErr(""); }}>取消</button>
          </div>
        </div>
      )}

      {itemsErr && <div style={{ color: "var(--ff-danger)", fontSize: 12, marginBottom: 10 }}>加载条目失败：{itemsErr}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)" }}>
            <Icons.Lock size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              {it.origPath && (
                <div style={{ fontSize: 11, color: "var(--ff-text-disabled)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.origPath}>
                  原位置：{it.origPath}
                </div>
              )}
            </div>
            <span style={{ fontSize: 12, color: "var(--ff-text-disabled)" }}>{fmtDate(it.addedAt * 1000)}</span>
            <button className="btn-ghost" onClick={async () => {
              try {
                // 第二道密码 = 查看门锁：已启用时打开/导出条目必须再次验证（防止他人借用已解锁电脑）
                if (status.hasSecondPassword) {
                  const pw = await promptDialog("第二道密码", { message: `查看「${it.name}」需要第二道密码`, password: true, confirmText: "验证" });
                  if (pw === null) return;
                  if (!(await verifySecondLocal(pw))) {
                    await alertDialog("第二道密码不正确", "条目未打开，请重试。", "error");
                    return;
                  }
                }
                const dest = await api.vaultOpen(it.id);
                await api.fsOpen(dest); // 解密导出到临时目录后用系统默认程序打开
              } catch (e) { await alertDialog("打开失败", String(e).replace(/^Error: /, ""), "error"); }
            }}>打开</button>
            <button className="btn-ghost" onClick={async () => {
              if (!it.origPath) {
                await alertDialog("无法自动还原", "该条目在旧版本存入，未记录原始位置。可先「打开」后另存到需要的位置。", "info");
                return;
              }
              const ok = await confirmDialog("移出保险箱", `将「${it.name}」解密还原到原位置：\n${it.origPath}\n\n目标位置已有同名文件时自动加序号（如 名 (1).txt），确定移出吗？`, { confirmText: "移出" });
              if (!ok) return;
              try {
                const dest = await api.vaultRestore(it.id);
                await alertDialog("移出成功", `已还原到：\n${dest}`, "success");
                await refresh();
              } catch (e) { await alertDialog("移出失败", String(e).replace(/^Error: /, ""), "error"); }
            }}>移出</button>
            <button className="btn-ghost" onClick={async () => {
              const ok = await confirmDialog("删除条目", `确定将「${it.name}」从保险箱删除吗？加密文件将被删除，不会还原到原位置。`, { danger: true, confirmText: "删除" });
              if (!ok) return;
              await api.vaultRemove(it.id);
              await refresh();
            }}><Icons.Trash size={13} /></button>
          </div>
        ))}
        {items.length === 0 && !itemsErr && <div style={{ color: "var(--ff-text-secondary)", fontSize: 13, padding: 16 }}>保险箱为空。在文件右键菜单选「移入保险箱」即可加密收入（需先解锁保险箱，原文件移入回收站）。</div>}
      </div>
    </VaultShell>
  );
};

const VaultShell: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide }) => (
  <div
    className="glass"
    style={{
      height: "100%", overflowY: "auto", display: "flex", alignItems: wide ? "flex-start" : "center", justifyContent: "center",
      background: "rgba(0,0,0,.35)",
    }}
  >
    <div style={{
      width: wide ? 640 : 400, margin: wide ? "40px auto" : undefined,
      background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", borderRadius: 16,
      padding: 28, boxShadow: "0 24px 80px rgba(0,0,0,.4)",
    }}>
      {children}
    </div>
  </div>
);
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ fontSize: 12, color: "var(--ff-text-secondary)", display: "block", marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);
const ErrorText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ color: "var(--ff-danger)", fontSize: 12, margin: "8px 0" }}>{children}</div>
);
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14,
  background: "var(--ff-bg-app)", color: "var(--ff-text-primary)",
  border: "1px solid var(--ff-border)", outline: "none",
};
