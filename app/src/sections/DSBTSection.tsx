import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Fingerprint, Building2, TrendingDown } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
  { icon: Fingerprint, title: 'On-chain reputation', desc: 'Immutable credit history' },
  { icon: Building2, title: 'Instant bank verification', desc: 'No paperwork required' },
  { icon: TrendingDown, title: 'Unlocks lower interest rates', desc: 'Better scores = better rates' },
];

export default function DSBTSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const gaugeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.dsbt-text', {
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

      gsap.from('.dsbt-gauge', {
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

      // Animate gauge stroke
      if (gaugeRef.current) {
        const circle = gaugeRef.current.querySelector('.gauge-progress');
        if (circle) {
          gsap.fromTo(circle, 
            { strokeDashoffset: 408 },
            {
              strokeDashoffset: 33,
              duration: 1.5,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: sectionRef.current,
                start: 'top 60%',
                toggleActions: 'play none none reverse'
              }
            }
          );
        }
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 px-4 lg:px-8 bg-surface">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* Left - Text Content */}
          <div className="dsbt-text">
            <span className="text-[10px] font-bold text-shg-primary uppercase tracking-widest mb-3 block">
              Dynamic Soulbound Token
            </span>
            <h2 className="text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
              Your Financial Health Passport
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              The d-SBT (dynamic soulbound token) updates automatically as you save, repay, and participate. 
              Banks can verify it instantly—no paperwork, no delays.
            </p>

            <div className="space-y-4">
              {features.map((feature, i) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-white rounded-xl border border-border/50">
                  <div className="w-10 h-10 bg-shg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-5 h-5 text-shg-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-on-surface mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right - Gauge Card */}
          <div className="dsbt-gauge flex justify-center">
            <div className="bg-white rounded-2xl p-8 border border-border/50 w-full max-w-sm">
              <h3 className="text-sm font-bold text-muted-foreground uppercase text-center mb-8">
                Aggregate Trust Index
              </h3>
              
              <div className="relative w-48 h-48 mx-auto flex items-center justify-center">
                <svg ref={gaugeRef} className="w-full h-full transform -rotate-90">
                  <circle
                    className="text-shg-secondary/20"
                    cx="96"
                    cy="96"
                    fill="transparent"
                    r="80"
                    stroke="currentColor"
                    strokeWidth="12"
                  />
                  <circle
                    className="gauge-progress text-shg-secondary"
                    cx="96"
                    cy="96"
                    fill="transparent"
                    r="80"
                    stroke="currentColor"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray="502"
                    strokeDashoffset="408"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-black font-headline text-on-surface">92</span>
                  <span className="text-[10px] font-bold text-shg-secondary uppercase tracking-tighter mt-1">Excellent</span>
                </div>
              </div>

              <p className="text-center text-sm text-muted-foreground mt-6">
                Regional SHGs are performing <span className="font-bold text-shg-secondary">14% better</span> than national institutional averages.
              </p>

              <div className="mt-6 pt-6 border-t border-border/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Your Score</span>
                  <span className="font-bold text-on-surface">850 / 1000</span>
                </div>
                <div className="w-full bg-surface h-2 rounded-full overflow-hidden mt-2">
                  <div className="bg-shg-secondary h-full rounded-full" style={{ width: '85%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
