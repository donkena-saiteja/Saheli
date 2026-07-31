import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { WifiOff, Shield, Printer, Share2, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
  { icon: Shield, title: 'Cryptographic proof', desc: 'Military-grade encryption' },
  { icon: WifiOff, title: 'Zero-knowledge privacy', desc: 'Share only what you want' },
  { icon: Printer, title: 'Print or share digitally', desc: 'WhatsApp, email, or paper' },
];

export default function OfflineProofSection() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.offline-qr', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 70%',
          toggleActions: 'play none none reverse'
        },
        x: -60,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out'
      });

      gsap.from('.offline-text', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 70%',
          toggleActions: 'play none none reverse'
        },
        x: 60,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out'
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 px-4 lg:px-8 bg-surface">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* Left - QR Code Card */}
          <div className="offline-qr flex justify-center lg:justify-start">
            <div className="bg-white rounded-2xl p-8 border border-border/50 w-full max-w-sm text-center">
              <div className="relative inline-block p-6 bg-white rounded-2xl shadow-xl border-4 border-surface mb-6">
                <div className="w-48 h-48 bg-gradient-to-br from-shg-primary/5 to-shg-secondary/5 rounded-lg flex items-center justify-center">
                  <svg viewBox="0 0 120 120" className="w-40 h-40">
                    {/* QR Code Pattern */}
                    <rect x="10" y="10" width="30" height="30" fill="#2D5CFF" />
                    <rect x="80" y="10" width="30" height="30" fill="#2D5CFF" />
                    <rect x="10" y="80" width="30" height="30" fill="#2D5CFF" />
                    
                    {/* Inner patterns */}
                    <rect x="50" y="10" width="8" height="8" fill="#191C1D" />
                    <rect x="62" y="10" width="8" height="8" fill="#191C1D" />
                    <rect x="50" y="22" width="8" height="8" fill="#191C1D" />
                    <rect x="58" y="30" width="8" height="8" fill="#191C1D" />
                    <rect x="74" y="22" width="8" height="8" fill="#191C1D" />
                    
                    <rect x="50" y="50" width="20" height="20" fill="#191C1D" />
                    
                    <rect x="80" y="50" width="8" height="8" fill="#191C1D" />
                    <rect x="95" y="58" width="8" height="8" fill="#191C1D" />
                    <rect x="80" y="70" width="8" height="8" fill="#191C1D" />
                    <rect x="95" y="78" width="8" height="8" fill="#191C1D" />
                    
                    <rect x="50" y="80" width="8" height="8" fill="#191C1D" />
                    <rect x="65" y="88" width="8" height="8" fill="#191C1D" />
                    <rect x="78" y="80" width="8" height="8" fill="#191C1D" />
                    <rect x="92" y="95" width="8" height="8" fill="#191C1D" />
                    <rect x="105" y="88" width="8" height="8" fill="#191C1D" />
                    
                    <rect x="18" y="50" width="8" height="8" fill="#191C1D" />
                    <rect x="32" y="58" width="8" height="8" fill="#191C1D" />
                    <rect x="25" y="70" width="8" height="8" fill="#191C1D" />
                    
                    {/* Center logo area */}
                    <circle cx="60" cy="60" r="12" fill="#2D5CFF" opacity="0.2" />
                    <path d="M54 60 L60 54 L66 60 L60 66 Z" fill="#2D5CFF" />
                  </svg>
                </div>
                <div className="absolute inset-0 border-2 border-shg-primary/10 rounded-2xl pointer-events-none" />
              </div>
              
              <h3 className="font-bold text-on-surface mb-2">Offline Proof</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Scan to verify identity & credit history
              </p>
              
              <div className="flex gap-2 justify-center">
                <button className="p-2 bg-surface rounded-lg hover:bg-shg-primary/10 transition-colors">
                  <Share2 className="w-4 h-4 text-shg-primary" />
                </button>
                <button className="p-2 bg-surface rounded-lg hover:bg-shg-primary/10 transition-colors">
                  <Printer className="w-4 h-4 text-shg-primary" />
                </button>
              </div>
            </div>
          </div>

          {/* Right - Text Content */}
          <div className="offline-text">
            <span className="text-[10px] font-bold text-shg-secondary uppercase tracking-widest mb-3 block">
              Rural-First Design
            </span>
            <h2 className="text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
              Works Without Internet
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Members can share a cryptographic QR code via WhatsApp or print it. 
              Bank officers scan it to verify transaction history—no installation required.
            </p>

            <div className="space-y-4 mb-8">
              {features.map((feature, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-shg-secondary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-5 h-5 text-shg-secondary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-on-surface">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button className="px-6 py-3 bg-shg-secondary text-white rounded-full font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity">
              See a Sample Verification
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
