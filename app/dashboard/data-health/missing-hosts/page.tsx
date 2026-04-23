"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MemberSearch from "@/components/MemberSearch";

interface PrickleTypeStats {
  prickle_type: string;
  prickle_type_id: string;
  requires_host: boolean;
  missing_host_count: number;
  default_host_id: string | null;
  default_host_name: string | null;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

interface PrickleWithoutHost {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  prickle_type: string;
  source: string;
}

export default function MissingHostsPage() {
  const [stats, setStats] = useState<PrickleTypeStats[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [prickles, setPrickles] = useState<PrickleWithoutHost[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    loadMembers();
  }, []);

  useEffect(() => {
    if (selectedType) {
      loadPrickles(selectedType);
    }
  }, [selectedType]);

  async function loadStats() {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("prickles")
      .select(`
        type_id,
        prickle_types!inner(name, requires_host, default_host_id, members(name))
      `)
      .is("host", null)
      .eq("source", "calendar");

    if (error) {
      console.error("Error loading stats:", error);
      setLoading(false);
      return;
    }

    // Group by type
    const typeMap = new Map<string, {
      name: string;
      requires_host: boolean;
      count: number;
      default_host_id: string | null;
      default_host_name: string | null;
    }>();

    data.forEach((p: any) => {
      const typeName = p.prickle_types.name;
      const requiresHost = p.prickle_types.requires_host;
      const defaultHostId = p.prickle_types.default_host_id;
      const defaultHostName = p.prickle_types.members?.name || null;

      if (!typeMap.has(p.type_id)) {
        typeMap.set(p.type_id, {
          name: typeName,
          requires_host: requiresHost,
          count: 0,
          default_host_id: defaultHostId,
          default_host_name: defaultHostName,
        });
      }

      const entry = typeMap.get(p.type_id)!;
      entry.count++;
    });

    const statsArray: PrickleTypeStats[] = Array.from(typeMap.entries()).map(([typeId, data]) => ({
      prickle_type: data.name,
      prickle_type_id: typeId,
      requires_host: data.requires_host,
      missing_host_count: data.count,
      default_host_id: data.default_host_id,
      default_host_name: data.default_host_name,
    }));

    // Sort: requires_host types first, then by count
    statsArray.sort((a, b) => {
      if (a.requires_host !== b.requires_host) {
        return a.requires_host ? -1 : 1;
      }
      return b.missing_host_count - a.missing_host_count;
    });

    setStats(statsArray);
    setLoading(false);
  }

  async function loadMembers() {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("members")
      .select("id, name, email")
      .eq("status", "active")
      .order("name");

    if (error) {
      console.error("Error loading members:", error);
      return;
    }

    setMembers(data || []);
  }

  async function loadPrickles(typeId: string) {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("prickles")
      .select(`
        id,
        title,
        start_time,
        end_time,
        source,
        prickle_types!inner(name)
      `)
      .eq("type_id", typeId)
      .is("host", null)
      .eq("source", "calendar")
      .order("start_time", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Error loading prickles:", error);
      return;
    }

    setPrickles(
      data.map((p: any) => ({
        id: p.id,
        title: p.title,
        start_time: p.start_time,
        end_time: p.end_time,
        prickle_type: p.prickle_types.name,
        source: p.source,
      }))
    );
  }

  async function toggleRequiresHost(typeId: string, currentValue: boolean) {
    const supabase = createClient();

    const { error } = await supabase
      .from("prickle_types")
      .update({ requires_host: !currentValue })
      .eq("id", typeId);

    if (error) {
      console.error("Error updating prickle type:", error);
      alert(`Failed to update: ${error.message}`);
      return;
    }

    // Reload stats
    loadStats();
  }

  async function setDefaultHost(typeId: string, member: Member | null) {
    const supabase = createClient();

    const { error } = await supabase
      .from("prickle_types")
      .update({ default_host_id: member?.id || null })
      .eq("id", typeId);

    if (error) {
      console.error("Error setting default host:", error);
      alert(`Failed to set default host: ${error.message}`);
      return;
    }

    // Reload stats
    loadStats();
  }

  const expectedUnhosted = stats.filter(s => !s.requires_host);
  const unexpectedUnhosted = stats.filter(s => s.requires_host);
  const totalUnexpected = unexpectedUnhosted.reduce((sum, s) => sum + s.missing_host_count, 0);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Prickles Missing Hosts</h1>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-8">
          {/* Summary */}
          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Data Quality Issues</p>
                <p className="text-2xl font-bold text-orange-600">{totalUnexpected}</p>
                <p className="text-sm text-gray-500">prickles requiring hosts</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Expected (No Host Required)</p>
                <p className="text-2xl font-bold text-gray-600">
                  {expectedUnhosted.reduce((sum, s) => sum + s.missing_host_count, 0)}
                </p>
                <p className="text-sm text-gray-500">prickles intentionally unhosted</p>
              </div>
            </div>
          </div>

          {/* Data Quality Issues */}
          {unexpectedUnhosted.length > 0 && (
            <div className="bg-white border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-orange-600">
                ⚠️ Missing Hosts (Data Quality Issues)
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                These prickle types should have hosts but don't. Click to investigate.
              </p>
              <div className="space-y-2">
                {unexpectedUnhosted.map((stat) => (
                  <div
                    key={stat.prickle_type_id}
                    className="p-3 bg-orange-50 rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium">{stat.prickle_type}</p>
                        <p className="text-sm text-gray-600">
                          {stat.missing_host_count} prickles missing hosts
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedType(stat.prickle_type_id)}
                        className="text-xs px-3 py-1 bg-white border rounded hover:bg-gray-50"
                      >
                        View
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <MemberSearch
                        members={members}
                        selectedMemberId={stat.default_host_id}
                        selectedMemberName={stat.default_host_name}
                        onSelect={(member) => setDefaultHost(stat.prickle_type_id, member)}
                        className="flex-1"
                      />
                      <button
                        onClick={() => toggleRequiresHost(stat.prickle_type_id, stat.requires_host)}
                        className="text-xs px-3 py-1 bg-white border rounded hover:bg-gray-50 whitespace-nowrap"
                      >
                        Mark Optional
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expected Unhosted */}
          {expectedUnhosted.length > 0 && (
            <div className="bg-white border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">
                ✓ Expected Unhosted Prickles
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                These prickle types don't require hosts (community events, self-directed time, etc.)
              </p>
              <div className="space-y-2">
                {expectedUnhosted.map((stat) => (
                  <div
                    key={stat.prickle_type_id}
                    className="p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-gray-700">{stat.prickle_type}</p>
                        <p className="text-sm text-gray-500">
                          {stat.missing_host_count} prickles (host not required)
                        </p>
                      </div>
                      <button
                        onClick={() => toggleRequiresHost(stat.prickle_type_id, stat.requires_host)}
                        className="text-xs px-3 py-1 bg-white border rounded hover:bg-gray-50 whitespace-nowrap"
                      >
                        Mark Required
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <MemberSearch
                        members={members}
                        selectedMemberId={stat.default_host_id}
                        selectedMemberName={stat.default_host_name}
                        onSelect={(member) => setDefaultHost(stat.prickle_type_id, member)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detail View */}
          {selectedType && (
            <div className="bg-white border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">
                  {stats.find((s) => s.prickle_type_id === selectedType)?.prickle_type} - Missing Hosts
                </h2>
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {prickles.map((prickle) => (
                  <div key={prickle.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium">
                          {prickle.title || prickle.prickle_type}
                        </p>
                        <p className="text-sm text-gray-600">
                          {new Date(prickle.start_time).toLocaleString()} -{" "}
                          {new Date(prickle.end_time).toLocaleTimeString()}
                        </p>
                      </div>
                      <span className="text-xs px-2 py-1 bg-gray-200 rounded">
                        {prickle.source}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {prickles.length === 100 && (
                <p className="text-sm text-gray-500 mt-4">Showing first 100 prickles</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
