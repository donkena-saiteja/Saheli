import { useState } from 'react';
import { Mail, Phone, MapPin, Send } from 'lucide-react';

export default function ContactSection() {
  const [formData, setFormData] = useState({
    name: '',
    organization: '',
    email: '',
    message: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission
    alert('Thank you for your interest! We will contact you soon.');
  };

  return (
    <section className="py-20 px-4 lg:px-8 bg-navy text-white">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left - Info */}
          <div>
            <h2 className="text-3xl lg:text-4xl font-black font-headline mb-4">
              Ready to bring transparent treasury to your SHG?
            </h2>
            <p className="text-white/70 mb-8 leading-relaxed">
              Request a demo and we'll set up a pilot for your group, cluster, or institution.
            </p>

            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                  <Mail className="w-5 h-5 text-shg-primary" />
                </div>
                <div>
                  <p className="text-sm text-white/50">Email us</p>
                  <p className="font-semibold">hello@saheli.org</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                  <Phone className="w-5 h-5 text-shg-secondary" />
                </div>
                <div>
                  <p className="text-sm text-white/50">Call us</p>
                  <p className="font-semibold">+91 80 0000 0000</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-shg-tertiary" />
                </div>
                <div>
                  <p className="text-sm text-white/50">Visit us</p>
                  <p className="font-semibold">Bangalore, India</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right - Form */}
          <div className="bg-white rounded-2xl p-6 lg:p-8">
            <h3 className="text-xl font-bold font-headline text-on-surface mb-6">
              Request a Demo
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 bg-surface rounded-xl border border-border/50 text-on-surface focus:outline-none focus:ring-2 focus:ring-shg-primary/20 focus:border-shg-primary transition-all"
                  placeholder="John Doe"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Organization
                </label>
                <input
                  type="text"
                  value={formData.organization}
                  onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                  className="w-full px-4 py-3 bg-surface rounded-xl border border-border/50 text-on-surface focus:outline-none focus:ring-2 focus:ring-shg-primary/20 focus:border-shg-primary transition-all"
                  placeholder="SHG Name / Bank / NGO"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-surface rounded-xl border border-border/50 text-on-surface focus:outline-none focus:ring-2 focus:ring-shg-primary/20 focus:border-shg-primary transition-all"
                  placeholder="john@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Message
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 bg-surface rounded-xl border border-border/50 text-on-surface focus:outline-none focus:ring-2 focus:ring-shg-primary/20 focus:border-shg-primary transition-all resize-none"
                  placeholder="Tell us about your requirements..."
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-shg-primary text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                <Send className="w-4 h-4" />
                Request a Demo
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <p className="font-headline font-bold text-lg">Saheli</p>
            <p className="text-sm text-white/50">© 2026 Saheli. Built for rural finance.</p>
          </div>
          <div className="flex gap-6">
            <a href="#" className="text-sm text-white/50 hover:text-white transition-colors">
              Terms of Service
            </a>
            <a href="#" className="text-sm text-white/50 hover:text-white transition-colors">
              Privacy Policy
            </a>
            <a href="#" className="text-sm text-shg-secondary hover:text-shg-secondary/80 transition-colors">
              Impact Report
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
