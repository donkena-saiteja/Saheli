import { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Toaster } from 'sonner';
import TopNav from './components/TopNav';
import Sidebar from './components/Sidebar';
import MemberDashboard from './dashboards/MemberDashboard';
import LeaderDashboard from './dashboards/LeaderDashboard';
import BankDashboard from './dashboards/BankDashboard';
import AuthPage from './components/AuthPage';
import HeroSection from './sections/HeroSection';
import HowItWorks from './sections/HowItWorks';
import AIAgentSection from './sections/AIAgentSection';
import DSBTSection from './sections/DSBTSection';
import OfflineProofSection from './sections/OfflineProofSection';
import MultiSigSection from './sections/MultiSigSection';
import WhatsAppSection from './sections/WhatsAppSection';
import ImpactMetrics from './sections/ImpactMetrics';
import ContactSection from './sections/ContactSection';
import WhatsAppDemo from './components/WhatsAppDemo';
import X402Console from './components/X402Console';
import AutoTranslate from './components/AutoTranslate';
import { useAuth } from './contexts/AuthContext';

gsap.registerPlugin(ScrollTrigger);

type UserRole = 'member' | 'leader' | 'bank';
type AppView = 'landing' | 'auth' | 'dashboard';
type DashboardSection =
  | 'passport'
  | 'treasury'
  | 'audit'
  | 'ai'
  | 'auto-repayment'
  | 'scanner'
  | 'grants'
  | 'x402'
  | 'settings'
  | 'support';



function getDefaultSection(role: UserRole): DashboardSection {
  if (role === 'member') return 'passport';
  if (role === 'leader') return 'treasury';
  return 'scanner';
}

function getRoleSections(role: UserRole): DashboardSection[] {
  if (role === 'member') return ['passport', 'treasury', 'audit', 'ai', 'auto-repayment', 'x402', 'settings', 'support'];
  if (role === 'leader') return ['treasury', 'audit', 'ai', 'x402', 'settings', 'support'];
  return ['scanner', 'audit', 'grants', 'x402', 'settings', 'support'];
}

function App() {
  const { user, loading, logout } = useAuth();
  const [view, setView] = useState<AppView>('landing');
  const [showWhatsAppDemo, setShowWhatsAppDemo] = useState(false);
  const [activeSection, setActiveSection] = useState<DashboardSection>('passport');

  useEffect(() => {
    if (loading) return;
    if (user) {
      // Authenticated — go straight to their dashboard
      setActiveSection(getDefaultSection(user.role as UserRole));
      setView('dashboard');
    } else {
      // No JWT session → always show auth page
      setView('auth');
    }
  }, [user, loading]);

  useEffect(() => {
    if (view !== 'dashboard') ScrollTrigger.refresh();
  }, [view]);

  const handleAuthSuccess = (role: UserRole) => {
    setActiveSection(getDefaultSection(role));
    setView('dashboard');
  };

  const handleRoleSelectFromHero = (_role: UserRole) => {
    setView('auth');
  };

  const handleSignOut = () => {
    logout();
    localStorage.removeItem('shg-role');
    setView('auth');
  };

  const handleSectionSearch = (query: string) => {
    if (!user) return;
    const q = query.toLowerCase().trim();
    if (!q) return;
    const sections = getRoleSections(user.role as UserRole);
    const match = sections.find((s) => s.toLowerCase().includes(q));
    if (match) {
      setActiveSection(match);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-white/50 text-sm">Restoring session…</p>
        </div>
      </div>
    );
  }

  if (view === 'auth') {
    return (
      <>
        <AutoTranslate />
        <Toaster position="top-right" richColors />
        <AuthPage onSuccess={handleAuthSuccess} />
      </>
    );
  }

  if (view === 'dashboard') {
    const authRole = user?.role as 'member' | 'leader' | 'bank' | undefined;
    const safeRole = (authRole || 'member') as UserRole;

    return (
      <div className="min-h-screen bg-surface">
        <AutoTranslate />
        <Toaster position="top-right" richColors />
        <TopNav
          currentRole={safeRole}
          authRole={authRole}
          onOpenAIAssistant={() => setShowWhatsAppDemo(true)}
          onSignOut={handleSignOut}
          onSectionSearch={handleSectionSearch}
        />
        <Sidebar
          currentRole={safeRole}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <main className="lg:ml-64 pt-16 min-h-screen">
          {activeSection === 'x402' && (
            <div className="p-6 max-w-6xl mx-auto">
              <X402Console />
            </div>
          )}
          {activeSection !== 'x402' && safeRole === 'member' && (
            <MemberDashboard
              activeSection={activeSection}
              onOpenAIAssistant={() => setShowWhatsAppDemo(true)}
            />
          )}
          {activeSection !== 'x402' && safeRole === 'leader' && (
            <LeaderDashboard activeSection={activeSection} isReadOnly={false} />
          )}
          {activeSection !== 'x402' && safeRole === 'bank' && (
            <BankDashboard activeSection={activeSection} />
          )}
        </main>
        {showWhatsAppDemo && <WhatsAppDemo onClose={() => setShowWhatsAppDemo(false)} />}
      </div>
    );
  }

  // Landing
  return (
    <div className="min-h-screen bg-surface">
      <AutoTranslate />
      <Toaster position="top-right" richColors />
      <TopNav />
      <HeroSection onRoleSelect={handleRoleSelectFromHero} onOpenWhatsApp={() => setShowWhatsAppDemo(true)} />
      <HowItWorks />
      <AIAgentSection />
      <DSBTSection />
      <OfflineProofSection />
      <MultiSigSection />
      <WhatsAppSection onTryDemo={() => setShowWhatsAppDemo(true)} />
      <ImpactMetrics />
      <ContactSection />
      {showWhatsAppDemo && <WhatsAppDemo onClose={() => setShowWhatsAppDemo(false)} />}
    </div>
  );
}

export default App;
