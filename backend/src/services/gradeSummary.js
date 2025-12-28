function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function parsePoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 100) return 100;
  return rounded;
}

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "graded" || s === "late" || s === "missing" || s === "excused") return s;
  return "graded";
}

function letterFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return "N/A";
  if (p >= 97) return "A+";
  if (p >= 93) return "A";
  if (p >= 90) return "A-";
  if (p >= 87) return "B+";
  if (p >= 83) return "B";
  if (p >= 80) return "B-";
  if (p >= 77) return "C+";
  if (p >= 73) return "C";
  if (p >= 70) return "C-";
  if (p >= 67) return "D+";
  if (p >= 63) return "D";
  if (p >= 60) return "D-";
  return "F";
}

function computeCategoryWeights(settings) {
  const weights = new Map();
  for (const c of Array.isArray(settings?.categories) ? settings.categories : []) {
    const name = String(c?.name || "").trim();
    if (!name) continue;
    const w = Number(c?.weightPct);
    if (!Number.isFinite(w)) continue;
    weights.set(name.toLowerCase(), clamp(Math.round(w), 0, 100));
  }
  return weights;
}

function computeStudentCurrentGradePercent({
  settings,
  assignments,
  grades,
  submittedAssignmentIds,
  now = new Date(),
}) {
  const gradeByAssignmentId = new Map();
  for (const g of Array.isArray(grades) ? grades : []) {
    if (!g?.assignmentId) continue;
    gradeByAssignmentId.set(String(g.assignmentId), g);
  }

  const submitted = new Set(
    Array.isArray(submittedAssignmentIds) ? submittedAssignmentIds.map((id) => String(id)) : []
  );

  const weights = computeCategoryWeights(settings);
  const earnedByCat = new Map();
  const possibleByCat = new Map();

  for (const a of Array.isArray(assignments) ? assignments : []) {
    const assignmentId = String(a?.id || "").trim();
    if (!assignmentId) continue;

    const categoryName = String(a?.category || "Homework").trim() || "Homework";
    const catKey = categoryName.toLowerCase();

    const pointsPossible = parsePoints(a?.points);
    const dueAt = String(a?.dueAt || "").trim();
    const dueDate = dueAt ? new Date(dueAt) : null;
    const pastDue = dueDate && !Number.isNaN(dueDate.valueOf()) ? dueDate < now : false;

    const g = gradeByAssignmentId.get(assignmentId);
    const status = normalizeStatus(g?.status);

    if (status === "excused") continue;

    let include = false;
    let earned = null;

    if (g && status === "missing") {
      include = true;
      earned = 0;
    } else if (g && Number.isFinite(Number(g.pointsEarned))) {
      include = true;
      earned = clamp(Number(g.pointsEarned), 0, pointsPossible);
    } else if (pastDue && !submitted.has(assignmentId)) {
      include = true;
      earned = 0;
    }

    if (!include) continue;

    const latePenaltyPerDayPct = clamp(Number(settings?.latePenaltyPerDayPct) || 0, 0, 100);
    const maxLatePenaltyPct = clamp(Number(settings?.maxLatePenaltyPct) || 0, 0, 100);
    const lateDaysOverride = Number(g?.lateDaysOverride);
    const lateDays = Number.isFinite(lateDaysOverride) ? clamp(Math.round(lateDaysOverride), 0, 365) : 0;

    if (lateDays > 0 && latePenaltyPerDayPct > 0) {
      const penaltyPct = clamp(lateDays * latePenaltyPerDayPct, 0, maxLatePenaltyPct);
      earned = clamp(earned * (1 - penaltyPct / 100), 0, pointsPossible);
    }

    earnedByCat.set(catKey, (earnedByCat.get(catKey) || 0) + earned);
    possibleByCat.set(catKey, (possibleByCat.get(catKey) || 0) + pointsPossible);
    if (!weights.has(catKey)) weights.set(catKey, 0);
  }

  const categories = [];
  for (const [catKey, possible] of possibleByCat.entries()) {
    if (!possible || possible <= 0) continue;
    const earned = earnedByCat.get(catKey) || 0;
    const percent = (earned / possible) * 100;
    categories.push({
      catKey,
      percent,
      weight: weights.get(catKey) || 0,
    });
  }

  if (categories.length === 0) return null;

  let weightSum = categories.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
  if (weightSum <= 0) {
    const equal = 100 / categories.length;
    categories.forEach((c) => (c.weight = equal));
    weightSum = 100;
  }

  const overall = categories.reduce((sum, c) => sum + c.percent * (c.weight / weightSum), 0);
  return clamp(overall, 0, 100);
}

function computeMissingAssignmentCount({ assignments, grades, submittedAssignmentIds, now = new Date() }) {
  const gradeByAssignmentId = new Map();
  for (const g of Array.isArray(grades) ? grades : []) {
    if (!g?.assignmentId) continue;
    gradeByAssignmentId.set(String(g.assignmentId), g);
  }

  const submitted = new Set(
    Array.isArray(submittedAssignmentIds) ? submittedAssignmentIds.map((id) => String(id)) : []
  );

  let count = 0;
  for (const a of Array.isArray(assignments) ? assignments : []) {
    const assignmentId = String(a?.id || "").trim();
    if (!assignmentId) continue;

    const dueAt = String(a?.dueAt || "").trim();
    const dueDate = dueAt ? new Date(dueAt) : null;
    const pastDue = dueDate && !Number.isNaN(dueDate.valueOf()) ? dueDate < now : false;
    if (!pastDue) continue;

    const g = gradeByAssignmentId.get(assignmentId);
    const status = normalizeStatus(g?.status);
    if (status === "excused") continue;
    if (status === "missing") {
      count += 1;
      continue;
    }

    // If they submitted, it's not missing.
    if (submitted.has(assignmentId)) continue;

    // If the teacher graded it (even 0), it's not missing in the "no submission" sense.
    if (g && Number.isFinite(Number(g.pointsEarned))) continue;

    count += 1;
  }

  return count;
}

module.exports = { computeStudentCurrentGradePercent, computeMissingAssignmentCount, letterFromPercent };
