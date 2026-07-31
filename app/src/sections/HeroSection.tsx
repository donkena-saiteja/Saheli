import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { 
  Landmark, 
  Verified, 
  Users,
  ArrowRight,
  BookOpen
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

interface HeroSectionProps {
  onRoleSelect: (role: 'member' | 'leader' | 'bank') => void;
  onOpenWhatsApp?: () => void;
}

export default function HeroSection({ onRoleSelect, onOpenWhatsApp }: HeroSectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Entrance animation
      gsap.from('.hero-sidebar', {
        x: -60,
        opacity: 0,
        duration: 0.8,
        ease: 'power2.out',
        delay: 0.2
      });

      gsap.from('.hero-main-card', {
        y: 80,
        opacity: 0,
        duration: 0.8,
        ease: 'power2.out',
        delay: 0.3
      });

      gsap.from('.hero-title', {
        y: 30,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        delay: 0.5
      });

      gsap.from('.hero-stat', {
        y: 40,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: 'power2.out',
        delay: 0.7
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="min-h-screen bg-surface pt-20 pb-12 px-4 lg:px-8">
      <div ref={contentRef} className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="hero-sidebar hidden lg:block w-64 bg-white rounded-2xl shadow-card p-6 h-[calc(100vh-8rem)] sticky top-24">
            <div className="mb-8">
              <h2 className="font-headline text-2xl font-black text-shg-primary">Saheli</h2>
              <p className="text-xs text-muted-foreground mt-1">Empowering Rural Finance</p>
            </div>
            <nav className="space-y-2">
              {[
                { icon: Verified, label: 'Financial Passport', active: true },
                { icon: Landmark, label: 'Treasury Management' },
                { icon: Verified, label: 'Audit Logs' },
                { icon: Users, label: 'AI Insights' },
              ].map((item, i) => (
                <a
                  key={i}
                  href="#"
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    item.active 
                      ? 'bg-shg-primary/10 text-shg-primary font-semibold' 
                      : 'text-muted-foreground hover:bg-surface'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{item.label}</span>
                </a>
              ))}
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            <div className="hero-main-card bg-white rounded-2xl shadow-card p-6 lg:p-10 min-h-[calc(100vh-8rem)]">
              {/* Header */}
              <div className="mb-8">
                <span className="text-[10px] font-bold text-shg-primary uppercase tracking-widest mb-3 block">
                  Self-Help Group Platform
                </span>
                <h1 className="hero-title text-3xl lg:text-5xl font-black font-headline text-on-surface tracking-tight mb-4">
                  Empowering Rural Finance.
                </h1>
                <p className="text-muted-foreground max-w-xl text-sm lg:text-base leading-relaxed">
                  A transparent, blockchain-backed treasury for groups, leaders, and institutions—simple enough for any member to use.
                </p>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4 mb-10">
                <button 
                  onClick={() => onRoleSelect('member')}
                  className="px-6 py-3 bg-shg-primary text-white rounded-full font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-shg-primary/20"
                >
                  Request a Demo
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button className="px-6 py-3 bg-white text-shg-primary border border-shg-primary/20 rounded-full font-semibold flex items-center gap-2 hover:bg-shg-primary/5 transition-colors" onClick={onOpenWhatsApp}>
                  <BookOpen className="w-4 h-4" />
                  Try WhatsApp Demo
                </button>
              </div>

              {/* Role Selection Cards */}
              <div className="mb-10">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">
                  Select Your Role to Explore
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { 
                      role: 'member' as const, 
                      title: 'Member', 
                      desc: 'View your financial passport',
                      icon: Verified,
                      color: 'bg-shg-primary/10 text-shg-primary'
                    },
                    { 
                      role: 'leader' as const, 
                      title: 'Leader', 
                      desc: 'Manage treasury & approvals',
                      icon: Landmark,
                      color: 'bg-shg-secondary/10 text-shg-secondary'
                    },
                    { 
                      role: 'bank' as const, 
                      title: 'Bank/NGO', 
                      desc: 'Institutional oversight',
                      icon: Users,
                      color: 'bg-shg-tertiary/10 text-shg-tertiary'
                    },
                  ].map((item) => (
                    <button
                      key={item.role}
                      onClick={() => onRoleSelect(item.role)}
                      className="group p-5 rounded-xl border border-border/50 hover:border-shg-primary/30 hover:shadow-card-hover transition-all text-left"
                    >
                      <div className={`w-10 h-10 rounded-lg ${item.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                        <item.icon className="w-5 h-5" />
                      </div>
                      <h3 className="font-bold text-on-surface mb-1">{item.title}</h3>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="hero-stat bg-surface rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-shg-primary/10 rounded-lg flex items-center justify-center">
                      <Landmark className="w-5 h-5 text-shg-primary" />
                    </div>
                    <span className="text-xs font-bold text-muted-foreground uppercase">Total Liquidity</span>
                  </div>
                  <p className="text-2xl font-black font-headline">₹4.2 Cr</p>
                </div>

                <div className="hero-stat bg-surface rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-shg-secondary/10 rounded-lg flex items-center justify-center">
                      <Verified className="w-5 h-5 text-shg-secondary" />
                    </div>
                    <span className="text-xs font-bold text-muted-foreground uppercase">Trust Score</span>
                  </div>
                  <p className="text-2xl font-black font-headline">92/100</p>
                </div>

                <div className="hero-stat bg-surface rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-shg-tertiary/10 rounded-lg flex items-center justify-center">
                      <Users className="w-5 h-5 text-shg-tertiary" />
                    </div>
                    <span className="text-xs font-bold text-muted-foreground uppercase">Active Members</span>
                  </div>
                  <p className="text-2xl font-black font-headline">12,847</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
