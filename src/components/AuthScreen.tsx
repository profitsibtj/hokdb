import React, { useState } from "react";
import { Lock, RefreshCw, Sun, Moon, X, PlusCircle } from "lucide-react";
import { clientDb } from "../dataClient";
import levelUpDark from "../assets/level-up-id-dark.png";
import levelUpLight from "../assets/level-up-id-light.png";

const HOK_LOGO_URL = "https://www.honorofkings.com/assets/favicon-CaeYdbfs.ico";

interface AuthScreenProps {
  onLogin: (token: string) => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLogin,
  isDarkMode,
  setIsDarkMode
}) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      if (clientDb.getIsStatic()) {
        const isValid = await clientDb.verifyAccessPassword(password);
        if (isValid) {
          onLogin(password);
        } else {
          setError("Incorrect password!");
        }
        return;
      }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        const data = await res.json();
        onLogin(data.token);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "Incorrect password!");
      }
    } catch (err: any) {
      try {
        const isValid = await clientDb.verifyAccessPassword(password);
        if (isValid) {
          onLogin(password);
        } else {
          setError("Incorrect password!");
        }
      } catch (clientErr: any) {
        setError("Network error: " + err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col justify-between transition-colors duration-300 relative overflow-hidden ${
      isDarkMode ? "bg-[#040814] text-slate-100" : "bg-slate-50 text-slate-900"
    }`}>
      {/* Background ambient radial glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[60%] rounded-full opacity-20 blur-[140px] transition-all duration-300 ${
          isDarkMode ? "bg-blue-500/60" : "bg-blue-500/20"
        }`} />
      </div>

      {/* HEADER BAR */}
      <header className={`relative z-10 flex justify-between items-center py-4 px-6 md:px-12 transition-colors duration-200 ${
        isDarkMode ? "border-b border-slate-900/60" : "shadow-sm bg-white/50 backdrop-blur-md"
      }`}>
        <div className="flex items-center gap-3">
          <img
            src={HOK_LOGO_URL}
            alt="Honor of Kings"
            className="h-10 w-10 object-contain"
          />
          <div className="flex flex-col">
            <span className="font-sans font-black tracking-wider text-sm leading-none uppercase">
              HOK DATABASE
            </span>
            <span className="text-[9px] font-mono font-bold tracking-widest text-slate-500 uppercase mt-1">
              LEVEL UP INDONESIA
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme switcher */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              isDarkMode
                ? "bg-slate-900/50 border border-slate-800 text-slate-400 hover:text-white"
                : "bg-slate-200/60 hover:bg-slate-200 text-slate-600"
            }`}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Launch App button */}
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-5 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-slate-950 font-bold text-xs tracking-wide transition-all shadow-lg shadow-blue-500/10 flex items-center gap-2 cursor-pointer"
          >
            <span>Launch App</span>
            <Lock className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* LANDING PAGE CONTENT BODY */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 md:py-24 text-center relative z-10 max-w-4xl mx-auto">
        {/* HERO TYPOGRAPHY */}
        <h1 className="flex flex-col gap-2 md:gap-4 select-none">
          <span className={`text-4xl md:text-6xl font-black uppercase tracking-tight ${
            isDarkMode ? "text-slate-100" : "text-slate-900"
          }`}>
            HONOR OF KINGS
          </span>
          <span className="text-4xl md:text-7xl font-black uppercase tracking-tight bg-gradient-to-r from-blue-500 via-blue-400 to-blue-600 bg-clip-text text-transparent drop-shadow-sm pb-1 leading-[1.1]">
            Esports Match Database
          </span>
        </h1>

        {/* PARAGRAPH DESCRIPTION */}
        <p className={`text-xs md:text-sm mt-6 leading-relaxed max-w-2xl font-medium transition-colors ${
          isDarkMode ? "text-slate-400" : "text-slate-600"
        }`}>
          Log match results, track pick/ban drafts across every game, and evaluate team and
          player performance (KDA, gold, hero pool, MVPs) with persistent cloud synchronization.
        </p>

        {/* MAIN ENTER BUTTON */}
        <div className="mt-10">
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-8 py-4 rounded-xl bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-slate-950 font-black text-xs md:text-sm tracking-widest uppercase transition-all shadow-xl shadow-blue-500/10 hover:shadow-blue-500/20 active:translate-y-0.5 flex items-center justify-center gap-3 cursor-pointer"
          >
            <PlusCircle className="w-5 h-5 shrink-0" />
            <span>ENTER ANALYTICS DATABASE</span>
          </button>
        </div>
      </main>

      {/* FOOTER */}
      <footer className={`relative z-10 py-6 transition-colors duration-200 text-center text-[10px] font-mono tracking-widest uppercase ${
        isDarkMode ? "border-t border-slate-900/60 text-slate-600" : "text-slate-400"
      }`}>
        <p>© 2026 Level Up Indonesia</p>
      </footer>

      {/* LOGIN PASS PIN MODAL POPUP */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className={`w-full max-w-md rounded-3xl overflow-hidden shadow-2xl relative transition-all duration-300 ${
            isDarkMode
              ? "bg-[#0b0f19]/90 border border-slate-800"
              : "bg-white shadow-slate-300"
          }`}>
            {/* Close Button */}
            <button
              onClick={() => {
                setShowLoginModal(false);
                setPassword("");
                setError("");
              }}
              className={`absolute top-4 right-4 p-2 rounded-xl transition-all cursor-pointer ${
                isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-850" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              }`}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 pb-4 pt-16 text-center mt-4">
              <div className={`absolute left-5 top-5 h-10 w-10 overflow-hidden rounded-xl ${
                isDarkMode ? "bg-black" : "bg-white"
              }`}>
                <img
                  src={isDarkMode ? levelUpDark : levelUpLight}
                  alt="Level Up Indonesia"
                  className="h-full w-full object-contain p-1.5"
                />
              </div>
              <h2 className={`text-xl font-black tracking-tight leading-tight uppercase font-sans ${
                isDarkMode ? "text-slate-100" : "text-slate-900"
              }`}>
                ACCESS VERIFICATION
              </h2>
              <p className={`text-[10px] mt-2 font-mono font-bold tracking-widest uppercase ${
                isDarkMode ? "text-slate-500" : "text-slate-400"
              }`}>
                ENTER DATABASE ACCESS PIN
              </p>
            </div>

            <form onSubmit={handleSubmit} className="p-8 pt-4 space-y-6">
              <div className="space-y-2">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="DATABASE ACCESS PIN"
                  className={`w-full rounded-xl py-3 px-4 text-center text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                    isDarkMode
                      ? "bg-slate-950 border border-slate-850 text-slate-100"
                      : "bg-slate-100 text-slate-900 focus:bg-white"
                  }`}
                  autoFocus
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/10 text-red-500 text-xs font-mono px-4 py-3 rounded-xl text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-slate-950 font-black text-xs tracking-wider uppercase transition-all shadow-lg shadow-blue-500/10 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>AUTHENTICATING...</span>
                  </>
                ) : (
                  <span>START ANALYSIS</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
