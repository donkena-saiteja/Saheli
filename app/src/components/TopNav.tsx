import { Search, Bell, Bot, User, Menu, X, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApiPolling } from '../hooks/useApi';
import { aiAgentApi } from '../lib/api';
import { toast } from 'sonner';

type UserRole = 'member' | 'leader' | 'bank';

interface TopNavProps {
  currentRole?: UserRole;
  authRole?: UserRole;
  onOpenAIAssistant?: () => void;
  onSignOut?: () => void;
  onSectionSearch?: (query: string) => void;
}

export default function TopNav({ currentRole, onOpenAIAssistant, onSignOut, onSectionSearch }: TopNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [lastOpenedAt, setLastOpenedAt] = useState(0);

  const roleLabels: Record<UserRole, string> = {
    member: 'Member',
    leader: 'Leader',
    bank:   'Bank/NGO',
  };

  const { data: aiLog } = useApiPolling(() => aiAgentApi.getLog(), 10000);

  const notifications = useMemo(
    () =>
      (aiLog || []).slice(0, 6).map((entry: any) => ({
        id: entry.id,
        title: entry.title,
        timestamp: new Date(entry.timestamp).getTime(),
      })),
    [aiLog],
  );

  const unreadCount = notifications.filter((n) => n.timestamp > lastOpenedAt).length;

  const runSearch = () => {
    const q = searchQuery.trim();
    if (!q) {
      toast.error('Enter a search term');
      return;
    }
    onSectionSearch?.(q);
    toast.success(`Searching for "${q}"`);
  };

  return (
    <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-border/50">
      <div className="flex justify-between items-center px-4 lg:px-6 py-3 w-full">
        {/* Logo */}
        <div className="flex items-center gap-8">
          <span className="text-xl font-extrabold tracking-tight text-shg-primary font-headline">
            Saheli
          </span>
          {currentRole && (
            <div className="hidden md:flex items-center bg-surface rounded-lg px-3 py-1.5 text-xs font-bold text-shg-primary">
              {roleLabels[currentRole]} Dashboard
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className={`hidden lg:flex items-center bg-surface rounded-lg transition-all ${searchOpen ? 'w-64' : 'w-48'}`}>
            <Search className="w-4 h-4 text-muted-foreground ml-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={currentRole ? 'Search transactions...' : 'Search SHG or member ID...'}
              className="bg-transparent border-none text-sm w-full py-2 px-2 focus:outline-none"
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch();
                }
              }}
            />
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setShowNotifications(v => !v);
                setLastOpenedAt(Date.now());
              }}
              className="p-2 hover:bg-surface rounded-lg transition-colors relative"
            >
              <Bell className="w-5 h-5 text-shg-primary" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-shg-secondary text-white rounded-full text-[10px] font-bold flex items-center justify-center">
                  {Math.min(unreadCount, 9)}
                </span>
              )}
            </button>
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-border rounded-xl shadow-xl p-2 z-50">
                <p className="px-2 py-1 text-xs font-bold text-muted-foreground uppercase tracking-wider">Notifications</p>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-2 py-3">No new alerts.</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.id} className="px-2 py-2 rounded-lg hover:bg-surface transition-colors">
                        <p className="text-sm font-semibold text-on-surface">{n.title}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(n.timestamp).toLocaleString('en-IN')}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AI Assistant */}
          <button onClick={onOpenAIAssistant} className="p-2 hover:bg-surface rounded-lg transition-colors">
            <Bot className="w-5 h-5 text-shg-primary" />
          </button>

          {/* Account */}
          <div className="w-8 h-8 rounded-full bg-shg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-shg-primary" />
          </div>
          {/* Account */}
          <div className="w-8 h-8 rounded-full bg-shg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-shg-primary" />
          </div>

          {/* Sign Out - Desktop */}
          {onSignOut && (
            <button
              onClick={onSignOut}
              title="Sign Out"
              className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden lg:inline">Sign Out</span>
            </button>
          )}

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 hover:bg-surface rounded-lg transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/50 bg-white px-4 py-3">
          <div className="flex flex-col gap-2">
            {onOpenAIAssistant && (
              <button
                onClick={() => {
                  onOpenAIAssistant();
                  setMobileMenuOpen(false);
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-left text-shg-primary hover:bg-shg-primary/5 transition-colors"
              >
                Open AI Assistant
              </button>
            )}
            {onSignOut && (
              <button
                onClick={() => {
                  onSignOut();
                  setMobileMenuOpen(false);
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-left text-red-600 hover:bg-red-50 transition-colors"
              >
                Sign Out
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
