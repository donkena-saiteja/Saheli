import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Brain, CheckCircle2, Zap, AlertTriangle, Clock, ArrowRight } from 'lucide-react';
import { useApiFetch } from '../hooks/useApi';
import { aiAgentApi } from '../lib/api';

gsap.registerPlugin(ScrollTrigger);

const fallbackActions = [
  { title: 'Reserve funds for upcoming repayment', status: 'Scheduled', statusColor: 'bg-shg-primary/10 text-shg-primary' },
  { title: 'Rebalance to higher yield vault', status: 'Pending approval', statusColor: 'bg-shg-tertiary/10 text-shg-tertiary' },
  { title: 'Notify members with low balance', status: 'Completed', statusColor: 'bg-shg-secondary/10 text-shg-secondary' },
];

const iconMap: Record<string, any> = {
  CheckCircle2,
  Zap,
  AlertTriangle,
  Clock,
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return `${Math.floor(diff / 86400000)} days ago`;
}

export default function AIAgentSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { data: logsData } = useApiFetch(() => aiAgentApi.getLog());
  const { data: insights } = useApiFetch(() => aiAgentApi.getInsights());

  const logs = (logsData || []).slice(0, 4);
  const actions = (insights?.insights || []).slice(0, 3).map((insight: any) => ({
    title: insight.title,
    status: insight.priority === 'high' ? 'Scheduled' : insight.priority === 'medium' ? 'Pending approval' : 'Completed',
    statusColor: insight.priority === 'high'
      ? 'bg-shg-primary/10 text-shg-primary'
      : insight.priority === 'medium'
        ? 'bg-shg-tertiary/10 text-shg-tertiary'
        : 'bg-shg-secondary/10 text-shg-secondary',
  }));

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.ai-panel-left', {
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

      gsap.from('.ai-panel-right', {
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

      gsap.from('.ai-log-item', {
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
        <div className="text-center mb-12">
          <span className="text-[10px] font-bold text-shg-primary uppercase tracking-widest mb-3 block">
            Autonomous Intelligence
          </span>
          <h2 className="text-3xl lg:text-4xl font-black font-headline text-on-surface mb-4">
            AI-Powered Treasury Management
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our AI agent monitors your treasury 24/7, automatically investing idle funds and approving eligible loans.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel - AI Log */}
          <div className="ai-panel-left bg-white rounded-2xl p-6 border border-border/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-shg-primary/10 rounded-lg flex items-center justify-center">
                <Brain className="w-5 h-5 text-shg-primary" />
              </div>
              <h3 className="text-lg font-bold font-headline">AI Treasury Log</h3>
              <div className="ml-auto w-2 h-2 bg-shg-secondary rounded-full animate-pulse" />
            </div>

            <div className="space-y-4">
              {(logs.length ? logs : [
                { id: 'f1', icon: 'CheckCircle2', title: 'Connected to live AI feed', highlight: 'Dynamic mode', timestamp: new Date().toISOString() },
              ]).map((log: any, i: number) => {
                const Icon = iconMap[log.icon] || CheckCircle2;
                const iconColor = log.type === 'loan_auto_approve'
                  ? 'text-shg-primary'
                  : log.type === 'yield_alert'
                    ? 'text-shg-tertiary'
                    : 'text-shg-secondary';
                return (
                <div key={i} className="ai-log-item flex gap-3 p-3 rounded-lg hover:bg-surface transition-colors">
                  <div className="mt-0.5">
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-on-surface leading-relaxed">
                      <span className="font-semibold">{log.title}</span>
                      {log.highlight && (
                        <span className="text-shg-secondary font-semibold"> {log.highlight}</span>
                      )}
                    </p>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase mt-1 block">
                      {timeAgo(log.timestamp)}
                    </span>
                  </div>
                </div>
                );
              })}
            </div>

            <button className="w-full mt-6 py-3 bg-surface text-shg-primary rounded-xl font-semibold text-sm hover:bg-shg-primary/5 transition-colors flex items-center justify-center gap-2">
              View Full Audit Log
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Right Panel - Agent Actions */}
          <div className="ai-panel-right bg-navy rounded-2xl p-6 text-white">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-shg-secondary" />
              </div>
              <h3 className="text-lg font-bold font-headline">Agent-Initiated Actions</h3>
            </div>

            <div className="space-y-4">
              {(actions.length ? actions : fallbackActions).map((action: any, i: number) => (
                <div key={i} className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{action.title}</p>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded ${action.statusColor}`}>
                      {action.status}
                    </span>
                  </div>
                  <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                    <div 
                      className="bg-shg-secondary h-full rounded-full transition-all duration-1000"
                      style={{ width: action.status === 'Completed' ? '100%' : action.status === 'Scheduled' ? '75%' : '45%' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-white/5 rounded-xl border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-shg-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">AI Insight</span>
              </div>
              <p className="text-sm text-white/80 italic">
                "Based on historical patterns, I recommend maintaining a 15% liquidity buffer for the upcoming harvest season."
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
