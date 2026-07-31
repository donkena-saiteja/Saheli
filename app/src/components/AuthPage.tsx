import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import {
  Verified, Landmark, Users, Eye, EyeOff, ArrowRight,
  Phone, Lock, User, ShieldCheck, Loader2, Link2
} from 'lucide-react';

type Role = 'member' | 'leader' | 'bank';
type Mode = 'login' | 'register';

interface AuthPageProps {
  onSuccess: (role: Role) => void;
}

const ROLES = [
  {
    id: 'member' as Role,
    label: 'Member',
    subtitle: 'View your financial passport & request loans',
    icon: Verified,
    gradient: 'from-blue-500 to-indigo-600',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    activeBg: 'bg-blue-600',
    demoPhone: '+91-9876543210',
  },
  {
    id: 'leader' as Role,
    label: 'SHG Leader',
    subtitle: 'Manage treasury, approve loans & multi-sig',
    icon: Landmark,
    gradient: 'from-emerald-500 to-green-600',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    activeBg: 'bg-emerald-600',
    demoPhone: '+91-9000000001',
  },
  {
    id: 'bank' as Role,
    label: 'Bank / NGO',
    subtitle: 'Institutional oversight & SHG directory',
    icon: Users,
    gradient: 'from-amber-500 to-orange-600',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    activeBg: 'bg-amber-600',
    demoPhone: '+91-9000000002',
  },
];

export default function AuthPage({ onSuccess }: AuthPageProps) {
  const { login, register, logout } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [role, setRole] = useState<Role>('member');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', password: '', shgId: '' });

  const selectedRole = ROLES.find(r => r.id === role)!;
  const Icon = selectedRole.icon;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        const user = await login(form.phone, form.password);
        if ((user.role as Role) !== role) {
          logout();
          toast.error(`This number is registered as ${user.role.toUpperCase()}, not ${role.toUpperCase()}. Please select the correct role.`);
          return;
        }
        toast.success(`Welcome back, ${user.name}! 🌟`);
        onSuccess(user.role as Role);
      } else {
        if (!form.name || !form.phone || !form.password) {
          toast.error('Please fill all required fields');
          return;
        }
        const user = await register({ name: form.name, phone: form.phone, password: form.password, role, shgId: form.shgId || undefined });
        toast.success(`Account created! Welcome, ${user.name} 🎉`);
        onSuccess(user.role as Role);
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = () => {
    setForm(f => ({ ...f, phone: selectedRole.demoPhone, password: 'demo1234' }));
    toast.info('Demo credentials filled!');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 flex items-center justify-center p-4">
      {/* Background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:48px_48px]" />

      <div className="relative w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2 mb-5">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            <span className="text-white/80 text-sm font-medium">Digitally secured identity</span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black text-white tracking-tight">
            Sa<span className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">heli</span>
          </h1>
          <p className="text-white/50 mt-2 text-sm">Empowering Rural Finance</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left — Role Selector */}
          <div className="space-y-4">
            <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-3">Select Your Role</p>
            {ROLES.map(r => {
              const RIcon = r.icon;
              const active = role === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setRole(r.id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 text-left group ${
                    active
                      ? 'bg-white/15 border-white/40 shadow-lg shadow-black/20 scale-[1.02]'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${r.gradient} flex items-center justify-center flex-shrink-0 shadow-lg transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-105'}`}>
                    <RIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className={`font-bold text-sm ${active ? 'text-white' : 'text-white/70'}`}>{r.label}</p>
                    <p className={`text-xs mt-0.5 ${active ? 'text-white/60' : 'text-white/40'}`}>{r.subtitle}</p>
                  </div>
                  {active && (
                    <div className="ml-auto w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30" />
                  )}
                </button>
              );
            })}

            {/* Demo hint */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mt-2">
              <p className="text-white/50 text-xs mb-2 font-semibold">🚀 Hackathon Demo</p>
              <p className="text-white/40 text-xs mb-3">For judging panel — seed demo users first, then:</p>
              <div className="text-xs text-white/50 font-mono space-y-1">
                <div>Member: +91-9876543210</div>
                <div>Leader: +91-9000000001</div>
                <div>Bank: &nbsp;&nbsp;+91-9000000002</div>
                <div className="text-white/30">Password: demo1234</div>
              </div>
            </div>
          </div>

          {/* Right — Auth Form */}
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl">
            {/* Mode Tabs */}
            <div className="flex bg-white/10 rounded-xl p-1 mb-7">
              {(['login', 'register'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-all duration-200 ${
                    mode === m
                      ? 'bg-white text-slate-900 shadow'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  {m === 'login' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
            </div>

            {/* Role Badge */}
            <div className={`inline-flex items-center gap-2 ${selectedRole.bg} ${selectedRole.text} ${selectedRole.border} border rounded-full px-3 py-1.5 mb-6`}>
              <Icon className="w-3.5 h-3.5" />
              <span className="text-xs font-bold">{selectedRole.label}</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    name="name"
                    type="text"
                    placeholder="Full Name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
                  />
                </div>
              )}

              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  name="phone"
                  type="text"
                  placeholder="Phone Number (+91-XXXXXXXXXX)"
                  value={form.phone}
                  onChange={handleChange}
                  required
                  className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl pl-11 pr-11 py-3.5 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {mode === 'register' && role !== 'bank' && (
                <div className="relative">
                  <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    name="shgId"
                    type="text"
                    placeholder="SHG Group ID (e.g. shg1)"
                    value={form.shgId}
                    onChange={handleChange}
                    className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={fillDemo}
                  className="px-4 py-3.5 rounded-xl border border-white/20 text-white/60 text-xs font-semibold hover:bg-white/10 hover:text-white/80 transition-all"
                >
                  Fill Demo
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className={`flex-1 flex items-center justify-center gap-2 bg-gradient-to-r ${selectedRole.gradient} text-white py-3.5 rounded-xl font-bold text-sm transition-all hover:opacity-90 active:scale-95 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {mode === 'login' ? 'Sign In' : 'Create Account'}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-6 pt-5 border-t border-white/10 text-center">
              <p className="text-white/40 text-xs">
                {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
                {' '}
                <button
                  onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                  className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                >
                  {mode === 'login' ? 'Sign Up' : 'Sign In'}
                </button>
              </p>
              <p className="text-white/20 text-xs mt-3">
                🔐 Secured with end-to-end encryption
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
