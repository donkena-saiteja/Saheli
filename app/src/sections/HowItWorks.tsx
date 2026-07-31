import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Users, Wallet, Shield } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const steps = [
  {
    icon: Users,
    title: 'Connect your group',
    description: 'Leaders invite members via WhatsApp. Secure accounts are created automatically.',
    color: 'bg-shg-primary/10 text-shg-primary'
  },
  {
    icon: Wallet,
    title: 'Save & borrow securely',
    description: 'Members deposit via voice or text. Loans are approved by AI + multi-leader approval, with rules enforced by system policies.',
    color: 'bg-shg-secondary/10 text-shg-secondary'
  },
  {
    icon: Shield,
    title: 'Build verifiable trust',
    description: 'Every repayment updates your trust score. Banks and NGOs can audit instantly—no paperwork.',
    color: 'bg-shg-tertiary/10 text-shg-tertiary'
  }
];

export default function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hiw-title', {
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

      gsap.from('.hiw-card', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 70%',
          toggleActions: 'play none none reverse'
        },
        y: 50,
        opacity: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: 'power2.out'
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 px-4 lg:px-8 bg-surface">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="hiw-title text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
            How Saheli works
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            From onboarding to trust-building, our platform simplifies every step of group financial management.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <div 
              key={i} 
              className="hiw-card bg-white rounded-2xl p-8 border border-border/50 hover:shadow-card-hover transition-shadow"
            >
              <div className={`w-14 h-14 ${step.color} rounded-xl flex items-center justify-center mb-6`}>
                <step.icon className="w-7 h-7" />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 bg-surface rounded-full flex items-center justify-center text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <h3 className="text-lg font-bold font-headline">{step.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
