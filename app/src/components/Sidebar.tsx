import { 
  Badge, 
  Wallet, 
  ShieldCheck, 
  Brain, 
  CalendarClock,
  QrCode,
  HandCoins,
  Zap,
  Settings, 
  HelpCircle 
} from 'lucide-react';

interface SidebarProps {
  currentRole?: 'member' | 'leader' | 'bank';
  activeSection?: string;
  onSectionChange?: (section: any) => void;
}

const roleMenu = {
  member: [
    { id: 'passport', label: 'Financial Passport', icon: Badge },
    { id: 'treasury', label: 'Treasury', icon: Wallet },
    { id: 'audit', label: 'Audit Logs', icon: ShieldCheck },
    { id: 'ai', label: 'AI Assistant', icon: Brain },
    { id: 'auto-repayment', label: 'Auto-Repayment', icon: CalendarClock },
    { id: 'x402', label: 'x402 Pay-per-Use', icon: Zap },
  ],
  leader: [
    { id: 'treasury', label: 'Treasury Management', icon: Wallet },
    { id: 'audit', label: 'Audit Logs', icon: ShieldCheck },
    { id: 'ai', label: 'AI Insights', icon: Brain },
    { id: 'x402', label: 'x402 Pay-per-Use', icon: Zap },
  ],
  bank: [
    { id: 'scanner', label: 'Launch Scanner', icon: QrCode },
    { id: 'audit', label: 'Audit Directory', icon: ShieldCheck },
    { id: 'grants', label: 'Grant Approval', icon: HandCoins },
    { id: 'x402', label: 'x402 Pay-per-Use', icon: Zap },
  ],
} as const;

const commonBottomItems = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'support', label: 'Support', icon: HelpCircle },
] as const;

export default function Sidebar({ currentRole = 'member', activeSection, onSectionChange }: SidebarProps) {
  const menuItems = roleMenu[currentRole];
  const selected = activeSection || (currentRole === 'member' ? 'passport' : currentRole === 'leader' ? 'treasury' : 'scanner');

  return (
    <aside className="hidden lg:flex h-screen w-64 fixed left-0 top-0 border-r border-border/50 bg-white flex-col py-6 z-40">
      {/* Logo Area */}
      <div className="px-6 mb-8 pt-16">
        <h2 className="font-headline text-2xl font-black text-shg-primary">Saheli</h2>
        <p className="text-xs font-medium text-muted-foreground mt-1">Empowering Rural Finance</p>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === selected;
          return (
            <button
              key={item.id}
              onClick={() => onSectionChange?.(item.id)}
              className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-shg-primary/10 text-shg-primary font-semibold'
                  : 'text-muted-foreground hover:bg-surface hover:text-on-surface'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-shg-primary' : 'text-muted-foreground group-hover:text-on-surface'}`} />
              <span className="font-medium text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="px-3 mt-auto space-y-4">
        {/* Bottom Links */}
        <div className="pt-4 border-t border-border/50 space-y-1">
          {commonBottomItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === selected;
            return (
              <button
                key={item.id}
                onClick={() => onSectionChange?.(item.id)}
                className={`flex w-full items-center gap-3 px-4 py-2 rounded-lg transition-colors text-left ${
                  isActive ? 'bg-shg-primary/10 text-shg-primary font-semibold' : 'text-muted-foreground hover:text-shg-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
