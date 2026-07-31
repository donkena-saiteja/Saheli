import { useState, useRef, useEffect } from 'react';
import { Mic, Send, X, MessageCircle, RotateCcw, ExternalLink, ShieldCheck } from 'lucide-react';
import { whatsappApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

/**
 * WhatsApp banking simulator.
 *
 * Drives the *same* state machine as the live Twilio webhook
 * (`/api/whatsapp/simulate` -> `handleWhatsAppMessage`), so what is shown here
 * is byte-for-byte what a real WhatsApp user receives. Nothing is faked in the
 * browser.
 */

interface Message {
  id: string;
  type: 'user' | 'bot' | 'typing';
  content: string;
  isVoice?: boolean;
  time: string;
  transactionId?: string;
  explorerUrl?: string;
  qrCode?: string;
}

const DEMO_PHONE = '+91-9876543210';

const QUICK_REPLIES = [
  { label: 'Hi', text: 'Hi' },
  { label: 'MPIN 1234', text: '1234' },
  { label: '1 · Balance', text: '1' },
  { label: '2 · Deposit', text: '2' },
  { label: '4 · Loan', text: '4' },
  { label: '6 · Trust Score', text: '6' },
  { label: 'YES', text: 'YES' },
  { label: 'MENU', text: 'MENU' },
];

const VOICE_SAMPLES = [
  'I need 5000 rupees urgently for hospital',
  'Deposit 500 rupees',
  'What is my balance',
];

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Renders WhatsApp *bold* and _italic_ markers the way the real client does. */
function formatWhatsApp(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const parts: React.ReactNode[] = [];
    const regex = /(\*[^*]+\*|_[^_]+_)/g;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      const token = m[0];
      if (token.startsWith('*')) {
        parts.push(
          <strong key={`${i}-${m.index}`} className="font-bold">
            {token.slice(1, -1)}
          </strong>,
        );
      } else {
        parts.push(
          <em key={`${i}-${m.index}`} className="italic text-gray-600">
            {token.slice(1, -1)}
          </em>,
        );
      }
      last = m.index + token.length;
    }
    if (last < line.length) parts.push(line.slice(last));

    return (
      <span key={i}>
        {parts.length ? parts : line}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

export default function WhatsAppDemo({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const phone = user?.phone || DEMO_PHONE;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<string>('GREETING');
  const [authed, setAuthed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string, isVoice = false) => {
    if (!text.trim() || loading) return;

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, type: 'user', content: text, isVoice, time: now() },
      { id: 'typing', type: 'typing', content: '', time: '' },
    ]);
    setInput('');
    setLoading(true);

    try {
      const res = await whatsappApi.simulate({ phone, message: text, fromVoice: isVoice });
      setState(res.state);
      setAuthed(res.authenticated);
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== 'typing')
          .concat({
            id: `b-${Date.now()}`,
            type: 'bot',
            content: res.message,
            time: now(),
            transactionId: res.transactionId,
            explorerUrl: res.explorerUrl,
            qrCode: res.qrCode,
          }),
      );
    } catch (e) {
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== 'typing')
          .concat({
            id: `e-${Date.now()}`,
            type: 'bot',
            content:
              '⚠️ Could not reach the Saheli API.\n\nStart the backend:\n`cd backend && npm run dev`',
            time: now(),
          }),
      );
    }
    setLoading(false);
  };

  const restart = async () => {
    try {
      await whatsappApi.reset(phone);
    } catch {
      /* resetting is best-effort */
    }
    setMessages([]);
    setState('GREETING');
    setAuthed(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[92vh] max-h-[760px]">
        {/* Header */}
        <div className="bg-[#075e54] px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm">Saheli Banking</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${authed ? 'bg-[#25d366]' : 'bg-amber-400'}`} />
              <p className="text-white/70 text-[11px] font-mono truncate">
                {authed ? 'secure session' : 'not signed in'} · {state}
              </p>
            </div>
          </div>
          <button
            onClick={restart}
            title="Restart session"
            className="text-white/70 hover:text-white p-1 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          {onClose && (
            <button onClick={onClose} className="text-white/70 hover:text-white p-1 transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Conversation */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-2.5"
          style={{
            background: '#e5ddd5',
            backgroundImage: 'radial-gradient(circle, #d4c9b0 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div className="flex justify-center">
            <div className="bg-white/85 backdrop-blur-sm text-[#075e54] px-3 py-1.5 rounded-lg text-[10px] font-semibold text-center max-w-[90%] shadow-sm">
              <ShieldCheck className="w-3 h-3 inline mr-1" />
              Same engine as the live Twilio webhook. Send <strong>Hi</strong> to begin.
            </div>
          </div>

          {messages.map((msg) =>
            msg.type === 'typing' ? (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-white rounded-xl px-4 py-2.5 shadow-sm">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2 shadow-sm ${
                    msg.type === 'user' ? 'bg-[#dcf8c6] rounded-tr-sm' : 'bg-white rounded-tl-sm'
                  }`}
                >
                  {msg.isVoice && (
                    <div className="flex items-center gap-1.5 mb-1 text-[#075e54]">
                      <Mic className="w-3 h-3" />
                      <span className="text-[10px] font-bold">Voice note · transcribed</span>
                    </div>
                  )}

                  <div className="text-[13px] text-gray-900 leading-relaxed whitespace-pre-wrap break-words">
                    {formatWhatsApp(msg.content)}
                  </div>

                  {msg.qrCode && (
                    <div className="mt-2.5 p-2 bg-gray-50 rounded-xl border border-gray-200 flex flex-col items-center">
                      <img src={msg.qrCode} alt="Transaction QR proof" className="w-32 h-32 rounded-lg" />
                      <p className="text-[9px] text-gray-500 mt-1 font-mono break-all text-center px-1">
                        {msg.transactionId}
                      </p>
                      {msg.explorerUrl && (
                        <a
                          href={msg.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-[#075e54] mt-1 hover:underline"
                        >
                          Verify on Algorand
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  )}

                  {msg.time && <p className="text-[10px] text-gray-500 mt-1 text-right">{msg.time} ✓✓</p>}
                </div>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>

        {/* Voice samples */}
        <div className="bg-white px-3 pt-2 flex gap-2 overflow-x-auto flex-shrink-0 border-t border-gray-100">
          {VOICE_SAMPLES.map((v) => (
            <button
              key={v}
              onClick={() => send(v, true)}
              disabled={loading}
              className="flex-shrink-0 text-[10px] px-2.5 py-1.5 rounded-full font-semibold bg-red-500/10 text-red-600 border border-red-200 hover:bg-red-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Mic className="w-2.5 h-2.5" />
              {v.length > 26 ? `${v.slice(0, 26)}…` : v}
            </button>
          ))}
        </div>

        {/* Quick replies */}
        <div className="bg-white px-3 pt-1.5 flex gap-1.5 overflow-x-auto flex-shrink-0">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q.label}
              onClick={() => send(q.text)}
              disabled={loading}
              className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full font-semibold bg-[#075e54]/10 text-[#075e54] hover:bg-[#075e54]/20 transition-colors disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* Composer */}
        <div className="bg-white px-3 py-3 flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 flex items-center bg-gray-100 rounded-full px-4 py-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder="Type a message…"
              className="bg-transparent text-sm flex-1 focus:outline-none text-gray-900"
              disabled={loading}
            />
          </div>
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="w-10 h-10 bg-[#075e54] rounded-full flex items-center justify-center disabled:opacity-50 hover:bg-[#128c7e] transition-colors active:scale-95"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
