export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Quill & Cup Admin Portal
            </h1>
            <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 text-sm font-medium rounded-full">
              In Development
            </span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Attendance & Engagement Analytics
          </h2>
          <p className="text-xl text-slate-600 dark:text-slate-300 mb-8">
            Your new command center for understanding member engagement across 50+ weekly Prickles
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg">
            <span className="text-2xl">🚀</span>
            <span className="font-medium">Coming Soon: Q2 2026</span>
          </div>
        </div>

        {/* What This Portal Will Do */}
        <div className="mb-16">
          <h3 className="text-2xl font-bold mb-8 text-center">What You'll Be Able To Do</h3>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon="🎯"
              title="Spot At-Risk Members"
              description="See who hasn't attended in 30 days and reach out before they churn."
              status="Phase 4"
            />
            <FeatureCard
              icon="📊"
              title="Track Session Popularity"
              description="Know which Prickles are hits and which might need adjustments."
              status="Phase 4"
            />
            <FeatureCard
              icon="📈"
              title="View Engagement Trends"
              description="Understand patterns in attendance and member activity over time."
              status="Phase 3"
            />
          </div>
        </div>

        {/* Dashboard Preview */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 mb-16 shadow-lg">
          <h3 className="text-2xl font-bold mb-8 text-center">Your Dashboard Will Show</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              label="Active Members"
              description="Total active members"
              example="127"
            />
            <MetricCard
              label="Attended Last 7 Days"
              description="Recent engagement"
              example="84"
            />
            <MetricCard
              label="Attended Last 30 Days"
              description="Monthly active"
              example="102"
            />
            <MetricCard
              label="At Risk"
              description="Need outreach"
              example="15"
            />
          </div>
        </div>

        {/* How Data Flows */}
        <div className="max-w-3xl mx-auto mb-16">
          <h3 className="text-2xl font-bold mb-8 text-center">How It Works Behind the Scenes</h3>
          <div className="space-y-6">
            <Step
              number="1"
              title="Sync Member Data"
              description="Pull active members, emails, and join dates from Kajabi daily."
            />
            <Step
              number="2"
              title="Import Zoom Attendance"
              description="Collect attendance records from your shared Zoom link (names, emails, join times)."
            />
            <Step
              number="3"
              title="Match Sessions"
              description="Intelligently match Zoom attendees to scheduled Prickles and member profiles, even with inconsistent names."
            />
            <Step
              number="4"
              title="Calculate Metrics"
              description="Compute engagement scores, risk levels, and session popularity trends automatically."
            />
          </div>
        </div>

        {/* Roadmap */}
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-8 mb-16">
          <h3 className="text-2xl font-bold mb-8 text-center">Development Roadmap</h3>
          <div className="max-w-3xl mx-auto space-y-4">
            <RoadmapItem
              phase="Phase 1"
              title="Data Ingestion & Schema"
              status="in-progress"
              items={["Database setup", "Kajabi sync", "Zoom import", "Session schedule import"]}
            />
            <RoadmapItem
              phase="Phase 2"
              title="Inference Logic"
              status="planned"
              items={["Attendance matching algorithm", "Confidence scoring", "Member enrichment"]}
            />
            <RoadmapItem
              phase="Phase 3"
              title="Dashboard UI"
              status="planned"
              items={["Member table", "Session popularity view", "Charts & visualizations"]}
            />
            <RoadmapItem
              phase="Phase 4"
              title="Engagement Scoring"
              status="planned"
              items={["Risk classification", "Engagement metrics", "Trend analysis"]}
            />
          </div>
        </div>

        {/* Tech Stack */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h3 className="text-2xl font-bold mb-4">Tech Stack</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            Built with modern tools for reliability, scalability, and ease of maintenance.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <TechBadge name="Next.js" description="Frontend framework" />
            <TechBadge name="Supabase" description="Backend & database" />
            <TechBadge name="PostgreSQL" description="Data storage" />
            <TechBadge name="Vercel" description="Hosting" />
          </div>
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              <strong>Medallion Architecture:</strong> Bronze (raw data) → Silver (inferred attendance) → Gold (analytics)
            </p>
          </div>
        </div>

        {/* Questions */}
        <div className="text-center bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-lg">
          <h3 className="text-2xl font-bold mb-4">Questions or Feedback?</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            This is a living project. Your input helps shape what we build.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/prd"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Read Full PRD
            </a>
            <a
              href="mailto:owner2@example.com"
              className="px-6 py-3 border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-semibold rounded-lg transition-colors"
            >
              Contact Cody
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 mt-16">
        <div className="container mx-auto px-6 text-center text-slate-500 dark:text-slate-400">
          <p>&copy; 2026 Quill & Cup. Internal Admin Portal.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description, status }: { icon: string; title: string; description: string; status: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow relative">
      <div className="absolute top-4 right-4">
        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-medium rounded">
          {status}
        </span>
      </div>
      <div className="text-4xl mb-4">{icon}</div>
      <h4 className="text-xl font-semibold mb-2">{title}</h4>
      <p className="text-slate-600 dark:text-slate-400">{description}</p>
    </div>
  );
}

function MetricCard({ label, description, example }: { label: string; description: string; example: string }) {
  return (
    <div className="text-center">
      <div className="text-4xl font-bold text-blue-600 dark:text-blue-400 mb-2">{example}</div>
      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{label}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{description}</div>
    </div>
  );
}

function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
        {number}
      </div>
      <div>
        <h4 className="text-xl font-semibold mb-1">{title}</h4>
        <p className="text-slate-600 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

function RoadmapItem({ phase, title, status, items }: { phase: string; title: string; status: string; items: string[] }) {
  const statusColors = {
    'in-progress': 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
    'planned': 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-1">{phase}</div>
          <h4 className="text-lg font-semibold">{title}</h4>
        </div>
        <span className={`px-3 py-1 text-xs font-medium rounded-full ${statusColors[status as keyof typeof statusColors]}`}>
          {status === 'in-progress' ? 'In Progress' : 'Planned'}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TechBadge({ name, description }: { name: string; description: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg">
      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{name}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
    </div>
  );
}
