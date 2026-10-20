"use client";

import { useState } from "react";
import { api } from "./workshop-api";

/** 초대 링크 접속: 처음이면 별명+PIN 으로 가입, 이미 있으면 같은 별명+PIN 으로 다시 들어가기 */
export default function JoinClass({ token }: { token: string }) {
  const [mode, setMode] = useState<"join" | "login">("join");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError(null);
    if (mode === "join" && pin !== pin2) return setError("PIN 두 번이 서로 달라요");
    setBusy(true);
    try {
      await api(`/api/workshop/${mode}`, { method: "POST", json: { invite: token, nickname, pin } });
      window.location.href = "/workshop";
    } catch (e) {
      setError(e instanceof Error ? e.message : "들어가지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dash" style={{ maxWidth: 460 }}>
      <div className="brand" style={{ marginBottom: 20 }}>
        <span className="brand-mark">모</span>
        모아 월드 학급 들어가기
      </div>
      <form
        className="card ws-pad"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <div className="seg" role="group" aria-label="들어가기 방식" style={{ marginBottom: 12 }}>
          <button type="button" className={mode === "join" ? "on" : ""} onClick={() => setMode("join")}>
            처음 들어가기
          </button>
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            다시 들어가기
          </button>
        </div>
        <div className="field">
          <label htmlFor="nick">별명</label>
          <input id="nick" className="input" maxLength={16} autoComplete="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="친구들이 볼 이름 (실명 말고)" />
        </div>
        <div className="field">
          <label htmlFor="pin">개인 PIN (숫자 4~6자리)</label>
          <input id="pin" className="input" inputMode="numeric" type="password" autoComplete={mode === "join" ? "new-password" : "current-password"} maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </div>
        {mode === "join" && (
          <div className="field">
            <label htmlFor="pin2">PIN 한 번 더</label>
            <input id="pin2" className="input" inputMode="numeric" type="password" autoComplete="new-password" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
          </div>
        )}
        {error && <div className="issue err" role="alert">{error}</div>}
        <button className="btn primary" style={{ marginTop: 12, width: "100%" }} disabled={busy || !nickname.trim() || pin.length < 4}>
          {mode === "join" ? "학급에 들어가기" : "다시 들어가기"}
        </button>
        <p className="ws-note">PIN 은 선생님도 볼 수 없게 암호화해서 저장해요. 잊어버리면 선생님께 말씀하세요.</p>
      </form>
    </main>
  );
}
