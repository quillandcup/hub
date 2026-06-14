export interface MemberForDuplication {
  id: string;
  name: string;
  email: string;
  status: string;
}

export interface DuplicateGroup {
  reason: string;
  members: MemberForDuplication[];
}

export function detectDuplicates(members: MemberForDuplication[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const usedKeys = new Set<string>();

  function groupKey(group: MemberForDuplication[]) {
    return group.map((m) => m.id).sort().join("|");
  }

  const byName = new Map<string, MemberForDuplication[]>();
  for (const member of members) {
    const key = member.name.toLowerCase().trim().replace(/\s+/g, " ");
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(member);
  }
  for (const group of byName.values()) {
    if (group.length > 1) {
      const key = groupKey(group);
      if (!usedKeys.has(key)) {
        usedKeys.add(key);
        groups.push({ reason: "Same name", members: group });
      }
    }
  }

  const byEmail = new Map<string, MemberForDuplication[]>();
  for (const member of members) {
    const key = member.email.toLowerCase().trim();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(member);
  }
  for (const group of byEmail.values()) {
    if (group.length > 1) {
      const key = groupKey(group);
      if (!usedKeys.has(key)) {
        usedKeys.add(key);
        groups.push({ reason: "Same email", members: group });
      }
    }
  }

  return groups;
}
