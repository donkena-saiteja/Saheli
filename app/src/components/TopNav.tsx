import {
  Search,
  Bell,
  Bot,
  User,
  Menu,
  X,
  LogOut,
  Wallet,
  Loader2,
  Settings,
  Copy,
  ExternalLink,
  BadgeCheck,
  Phone,
  ChevronDown,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiPolling } from '../hooks/useApi';
import { aiAgentApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { isUserCancellation, shortenAddress } from '../lib/pera';
import { toast } from 'sonner';

type UserRole = 'member' | 'leader' | 'bank';

interface TopNavProps {
  currentRole?: UserRole;
  authRole?: UserRole;
  onOpenAIAssistant?: () => void;
  onSignOut?: () => void;
  onSectionSearch?: (query: string) => void;
  onOpenSettings?: () => void;
}

export default function TopNav({
  currentRole,
  onOpenAIAssistant,
  onSignOut,
  onSectionSearch,
  onOpenSettings,
}: TopNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [lastOpenedAt, setLastOpenedAt] = useState(0);

  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const roleLabels: Record<UserRole, string> = {
    member: 'Member',
    leader: 'Leader',
    bank:   'Bank/NGO',
  };

  const { user, walletAddress, walletConnecting, linkPeraWallet, disconnectWallet } = useAuth();
  const linkedWallet = user?.walletAddress || walletAddress;

  const { data: aiLog } = useApiPolling(() => aiAgentApi.getLog(), 10000);

  const handleWalletClick = async () => {
    if (user?.walletAddress) {
      toast.info(`Wallet linked: ${user.walletAddress}`);
      return;
    }
    if (walletAddress) {
      await disconnectWallet();
      toast.info('Pera Wallet disconnected.');
      return;
    }
    try {
      const address = await linkPeraWallet();
      toast.success(`Pera Wallet linked: ${shortenAddress(address)}`);
    } catch (err) {
      if (isUserCancellation(err)) {
        toast.info('Pera Wallet request cancelled.');
      } else {
        toast.error((err as Error).message || 'Could not link Pera Wallet');
      }
    }
  };

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

  // Close whichever popover is open when the user clicks elsewhere or hits Esc.
  useEffect(() => {
    if (!showProfile && !showNotifications) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (showProfile && profileRef.current && !profileRef.current.contains(target)) {
        setShowProfile(false);
      }
      if (showNotifications && notificationsRef.current && !notificationsRef.current.contains(target)) {
        setShowNotifications(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowProfile(false);
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showProfile, showNotifications]);

  const initials = (user?.name || 'Saheli User')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const explorerBase =
    String(import.meta.env.VITE_ALGORAND_NETWORK || 'testnet').toLowerCase() === 'mainnet'
      ? 'https://lora.algokit.io/mainnet'
      : 'https://lora.algokit.io/testnet';

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

          <div className="relative" ref={notificationsRef}>
            <button
              onClick={() => {
                setShowNotifications(v => !v);
                setShowProfile(false);
                setLastOpenedAt(Date.now());
              }}
              aria-label="Notifications"
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

          {/* Pera Wallet — shows the linked address, or offers to link one */}
          {currentRole && (
            <button
              onClick={handleWalletClick}
              disabled={walletConnecting}
              title={linkedWallet ? linkedWallet : 'Connect your Pera Wallet'}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-60 ${
                linkedWallet
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-surface text-muted-foreground hover:text-shg-primary'
              }`}
            >
              {walletConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wallet className="w-4 h-4" />
              )}
              <span className="font-mono">
                {linkedWallet ? shortenAddress(linkedWallet) : 'Connect Pera'}
              </span>
            </button>
          )}

          {/* Account — a real menu, not a decorative avatar */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => {
                setShowProfile((v) => !v);
                setShowNotifications(false);
              }}
              aria-haspopup="menu"
              aria-expanded={showProfile}
              aria-label="Open profile menu"
              className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full transition-colors ${
                showProfile ? 'bg-shg-primary/10' : 'hover:bg-surface'
              }`}
            >
              <span className="w-8 h-8 rounded-full bg-shg-primary text-white flex items-center justify-center text-xs font-black">
                {initials || <User className="w-4 h-4" />}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showProfile ? 'rotate-180' : ''}`}
              />
            </button>

            {showProfile && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-80 bg-white border border-border rounded-2xl shadow-xl z-50 overflow-hidden"
              >
                {/* Identity */}
                <div className="p-4 bg-gradient-to-br from-shg-primary to-blue-700 text-white">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-sm font-black">
                      {initials || <User className="w-5 h-5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold leading-tight truncate">{user?.name || 'Saheli User'}</p>
                      <p className="text-xs text-white/70 inline-flex items-center gap-1 mt-0.5">
                        <BadgeCheck className="w-3 h-3" />
                        {currentRole ? roleLabels[currentRole] : 'Guest'}
                        {user?.shgId ? ` · ${user.shgId.toUpperCase()}` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-2">
                  {user?.phone && (
                    <div className="px-3 py-2 flex items-center gap-2 text-sm text-on-surface">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-xs">{user.phone}</span>
                    </div>
                  )}

                  {user?._id && (
                    <button
                      onClick={() => copyToClipboard(user._id, 'Member ID')}
                      className="w-full px-3 py-2 flex items-center gap-2 text-sm rounded-lg hover:bg-surface transition-colors text-left"
                    >
                      <BadgeCheck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-xs truncate flex-1">{user._id}</span>
                      <Copy className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    </button>
                  )}

                  {/* Wallet block */}
                  <div className="mt-1 p-3 rounded-xl bg-surface">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Pera Wallet
                    </p>
                    {linkedWallet ? (
                      <>
                        <button
                          onClick={() => copyToClipboard(linkedWallet, 'Wallet address')}
                          className="w-full flex items-center gap-2 text-left group"
                        >
                          <span className="font-mono text-xs text-on-surface truncate flex-1">
                            {shortenAddress(linkedWallet)}
                          </span>
                          <Copy className="w-3 h-3 text-muted-foreground group-hover:text-shg-primary" />
                        </button>
                        <div className="flex gap-2 mt-2">
                          <a
                            href={`${explorerBase}/account/${linkedWallet}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-bold text-shg-primary bg-white border border-border rounded-lg py-1.5 hover:bg-shg-primary/5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Explorer
                          </a>
                          {!user?.walletAddress && (
                            <button
                              onClick={async () => {
                                await disconnectWallet();
                                toast.info('Pera Wallet disconnected.');
                                setShowProfile(false);
                              }}
                              className="flex-1 text-[11px] font-bold text-muted-foreground bg-white border border-border rounded-lg py-1.5 hover:text-red-600"
                            >
                              Disconnect
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <button
                        onClick={async () => {
                          await handleWalletClick();
                          setShowProfile(false);
                        }}
                        disabled={walletConnecting}
                        className="w-full inline-flex items-center justify-center gap-1.5 bg-[#FFEE55] text-slate-900 rounded-lg py-2 text-xs font-bold disabled:opacity-60"
                      >
                        {walletConnecting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Wallet className="w-3.5 h-3.5" />
                        )}
                        Connect Pera Wallet
                      </button>
                    )}
                  </div>

                  <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
                    {onOpenSettings && (
                      <button
                        onClick={() => {
                          onOpenSettings();
                          setShowProfile(false);
                        }}
                        className="w-full px-3 py-2 flex items-center gap-2.5 text-sm font-semibold rounded-lg hover:bg-surface transition-colors text-left"
                      >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                        Settings
                      </button>
                    )}
                    {onOpenAIAssistant && (
                      <button
                        onClick={() => {
                          onOpenAIAssistant();
                          setShowProfile(false);
                        }}
                        className="w-full px-3 py-2 flex items-center gap-2.5 text-sm font-semibold rounded-lg hover:bg-surface transition-colors text-left"
                      >
                        <Bot className="w-4 h-4 text-muted-foreground" />
                        AI Assistant
                      </button>
                    )}
                    {onSignOut && (
                      <button
                        onClick={() => {
                          setShowProfile(false);
                          onSignOut();
                        }}
                        className="w-full px-3 py-2 flex items-center gap-2.5 text-sm font-semibold rounded-lg text-red-600 hover:bg-red-50 transition-colors text-left"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
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
