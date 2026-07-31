import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CheckCircle2, Users, Lock, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const steps = [
  { label: 'Leader A approves', status: 'approved', icon: CheckCircle2 },
  { label: 'Leader B approves', status: 'approved', icon: CheckCircle2 },
  { label: 'Treasury executes', status: 'pending', icon: Lock },
];

export default function MultiSigSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.multisig-visual', {
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

      gsap.from('.multisig-text', {
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

      gsap.from('.multisig-step', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 60%',
          toggleActions: 'play none none reverse'
        },
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.15,
        ease: 'power2.out'
      });

      // Animate connecting line
      if (lineRef.current) {
        gsap.fromTo(lineRef.current,
          { scaleY: 0 },
          {
            scaleY: 1,
            duration: 1,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 50%',
              toggleActions: 'play none none reverse'
            }
          }
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 px-4 lg:px-8 bg-surface">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* Left - Visual */}
          <div className="multisig-visual">
            <div className="bg-white rounded-2xl p-8 border border-border/50">
              <div className="relative">
                {/* Connecting Line */}
                <div 
                  ref={lineRef}
                  className="absolute left-8 top-12 w-0.5 h-[calc(100%-6rem)] bg-shg-secondary/30 origin-top"
                />

                {/* Steps */}
                <div className="space-y-6">
                  {steps.map((step, i) => (
                    <div key={i} className="multisig-step flex items-center gap-4 relative z-10">
                      <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                        step.status === 'approved' 
                          ? 'bg-shg-secondary/10' 
                          : 'bg-shg-tertiary/10'
                      }`}>
                        <step.icon className={`w-8 h-8 ${
                          step.status === 'approved' 
                            ? 'text-shg-secondary' 
                            : 'text-shg-tertiary'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-on-surface">{step.label}</p>
                        <p className={`text-sm ${
                          step.status === 'approved' 
                            ? 'text-shg-secondary' 
                            : 'text-shg-tertiary'
                        }`}>
                          {step.status === 'approved' ? 'Confirmed' : 'Waiting...'}
                        </p>
                      </div>
                      {step.status === 'approved' && (
                        <CheckCircle2 className="w-5 h-5 text-shg-secondary" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Transaction Card */}
              <div className="mt-8 p-4 bg-surface rounded-xl border border-border/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Transaction</span>
                  <span className="text-xs text-shg-primary font-bold">#TX-8842</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="text-lg font-bold font-headline">₹50,000.00</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right - Text Content */}
          <div className="multisig-text">
            <span className="text-[10px] font-bold text-shg-tertiary uppercase tracking-widest mb-3 block">
              Security First
            </span>
            <h2 className="text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
              Role-Based Approvals
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Large withdrawals require multiple leaders to approve. Rules are enforced by strict system policies—transparent, auditable, and fair.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="p-4 bg-white rounded-xl border border-border/50">
                <div className="w-10 h-10 bg-shg-primary/10 rounded-lg flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-shg-primary" />
                </div>
                <p className="font-bold text-on-surface text-sm">2-of-3 Approval</p>
                <p className="text-xs text-muted-foreground">Minimum required</p>
              </div>
              <div className="p-4 bg-white rounded-xl border border-border/50">
                <div className="w-10 h-10 bg-shg-secondary/10 rounded-lg flex items-center justify-center mb-3">
                  <Lock className="w-5 h-5 text-shg-secondary" />
                </div>
                <p className="font-bold text-on-surface text-sm">System Policy</p>
                <p className="text-xs text-muted-foreground">Immutable rules</p>
              </div>
            </div>

            <button className="px-6 py-3 bg-shg-tertiary text-white rounded-full font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity">
              Explore Security Features
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
