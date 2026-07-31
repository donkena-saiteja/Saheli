import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { TrendingUp, Users, Building2, Clock } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const metrics = [
  { 
    icon: TrendingUp, 
    value: '₹4.2 Cr', 
    label: 'Regional liquidity pooled',
    color: 'bg-shg-primary/10 text-shg-primary'
  },
  { 
    icon: Users, 
    value: '99.2%', 
    label: 'On-time repayment rate',
    color: 'bg-shg-secondary/10 text-shg-secondary'
  },
  { 
    icon: Building2, 
    value: '128', 
    label: 'Active grants under management',
    color: 'bg-shg-tertiary/10 text-shg-tertiary'
  },
  { 
    icon: Clock, 
    value: '6s', 
    label: 'Average block confirmation',
    color: 'bg-shg-primary/10 text-shg-primary'
  },
];

export default function ImpactMetrics() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.impact-title', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        },
        y: 30,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out'
      });

      gsap.from('.impact-card', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 70%',
          toggleActions: 'play none none reverse'
        },
        y: 50,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: 'power2.out'
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 px-4 lg:px-8 bg-surface">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="impact-title text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
            Built for Scale. Designed for Trust.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            From village groups to regional institutions—Saheli keeps finance transparent, auditable, and accessible.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {metrics.map((metric, i) => (
            <div 
              key={i} 
              className="impact-card bg-white rounded-2xl p-6 border border-border/50 hover:shadow-card-hover transition-shadow"
            >
              <div className={`w-12 h-12 ${metric.color} rounded-xl flex items-center justify-center mb-4`}>
                <metric.icon className="w-6 h-6" />
              </div>
              <p className="text-2xl lg:text-3xl font-black font-headline text-on-surface mb-1">
                {metric.value}
              </p>
              <p className="text-sm text-muted-foreground">{metric.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
