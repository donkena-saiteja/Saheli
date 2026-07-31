import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Mic, MessageCircle, CheckCircle2, Brain, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const messages = [
  { type: 'user', content: 'I want to deposit 500 rupees.', isVoice: true, time: '10:30 AM' },
  { type: 'system', content: 'Confirming... Done. Receipt sent.', time: '10:31 AM' },
  { type: 'user', content: 'I need a small loan for medicines.', isVoice: true, time: '2:15 PM' },
  { type: 'ai', content: 'Loan approved! ₹5,000 will be disbursed to your account.', time: '2:15 PM' },
];

export default function WhatsAppSection({ onTryDemo }: { onTryDemo?: () => void }) {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.whatsapp-phone', {
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

      gsap.from('.whatsapp-text', {
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

      gsap.from('.whatsapp-message', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 60%',
          toggleActions: 'play none none reverse'
        },
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.1,
        ease: 'power2.out'
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 px-4 lg:px-8 bg-surface">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* Left - Phone Mockup */}
          <div className="whatsapp-phone flex justify-center lg:justify-start">
            <div className="bg-white rounded-[2.5rem] p-4 shadow-card border border-border/50 w-full max-w-sm">
              {/* Phone Header */}
              <div className="bg-shg-primary rounded-t-2xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Saheli Bot</p>
                  <p className="text-white/70 text-xs">Online</p>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="bg-surface p-4 space-y-3 min-h-[300px]">
                {/* AI Badge */}
                <div className="flex justify-center mb-4">
                  <div className="bg-shg-primary/10 text-shg-primary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                    <Brain className="w-3 h-3" />
                    AI Powered
                  </div>
                </div>

                {messages.map((msg, i) => (
                  <div 
                    key={i} 
                    className={`whatsapp-message flex ${
                      msg.type === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div className={`max-w-[80%] ${
                      msg.type === 'user' 
                        ? 'bg-shg-primary text-white rounded-2xl rounded-tr-sm' 
                        : msg.type === 'system'
                        ? 'bg-white text-on-surface rounded-2xl rounded-tl-sm border border-border/50'
                        : 'bg-shg-secondary/10 text-shg-secondary rounded-2xl rounded-tl-sm border border-shg-secondary/20'
                    } px-4 py-2.5`}
                    >
                      <div className="flex items-center gap-2">
                        {msg.isVoice && <Mic className="w-4 h-4" />}
                        <p className="text-sm">{msg.content}</p>
                      </div>
                      <p className={`text-[10px] mt-1 ${
                        msg.type === 'user' ? 'text-white/60' : 'text-muted-foreground'
                      }`}>
                        {msg.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input Area */}
              <div className="bg-white rounded-b-2xl p-3 border-t border-border/50">
                <div className="flex items-center gap-2 bg-surface rounded-full px-4 py-2">
                  <Mic className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground flex-1">Type a message...</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right - Text Content */}
          <div className="whatsapp-text">
            <span className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-3 block">
              WhatsApp Integration
            </span>
            <h2 className="text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
              Speak to Save. Chat to Borrow.
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Members send a voice note in their language. AI transcribes, verifies, and completes the transaction—no apps to install.
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Mic className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-bold text-on-surface">Voice-First Interface</h3>
                  <p className="text-sm text-muted-foreground">Speak in your local language</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Brain className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-bold text-on-surface">AI-Powered Processing</h3>
                  <p className="text-sm text-muted-foreground">Instant transcription & verification</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-bold text-on-surface">Zero-Friction Onboarding</h3>
                  <p className="text-sm text-muted-foreground">No app installation required</p>
                </div>
              </div>
            </div>

            <button onClick={onTryDemo} className="px-6 py-3 bg-green-600 text-white rounded-full font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity">
              Try the Demo
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
