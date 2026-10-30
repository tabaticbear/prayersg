// Prayer points for a school, drawn from what MOE publishes about it.

const VERSES = [
  ["Proverbs 22:6", "Train up a child in the way he should go; even when he is old he will not depart from it."],
  ["Proverbs 9:10", "The fear of the LORD is the beginning of wisdom, and the knowledge of the Holy One is insight."],
  ["James 1:5", "If any of you lacks wisdom, let him ask God, who gives generously to all without reproach, and it will be given him."],
  ["Jeremiah 29:7", "Seek the welfare of the city where I have sent you… and pray to the LORD on its behalf, for in its welfare you will find your welfare."],
  ["Matthew 19:14", "Let the little children come to me and do not hinder them, for to such belongs the kingdom of heaven."],
  ["1 Timothy 4:12", "Let no one despise you for your youth, but set the believers an example in speech, in conduct, in love, in faith, in purity."],
  ["Isaiah 54:13", "All your children shall be taught by the LORD, and great shall be the peace of your children."],
  ["Psalm 127:1", "Unless the LORD builds the house, those who build it labour in vain. Unless the LORD watches over the city, the watchman stays awake in vain."],
  ["Philippians 4:6–7", "Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God."],
  ["Colossians 3:23", "Whatever you do, work heartily, as for the Lord and not for men."],
  ["Daniel 1:17", "As for these four youths, God gave them learning and skill in all literature and wisdom."],
  ["Luke 2:52", "And Jesus increased in wisdom and in stature and in favour with God and man."],
];

function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function verseFor(school) {
  return VERSES[hash(school.name) % VERSES.length];
}

const isPrimary = (s) => /primary/i.test(s.level ?? "");
const isSecondary = (s) => /secondary|\bS1\b/i.test(s.level ?? ""); // incl. "Mixed Level (S1-Jc2)"
const isJC = (s) => /junior college|centralised/i.test(s.level ?? "");

export function prayerPoints(s) {
  const pts = [];
  const students = isPrimary(s) ? "the children" : "the students";

  // Leadership, by name where MOE lists them.
  if (s.principal) {
    const vps = s.vicePrincipals?.length ? `, and vice-principal${s.vicePrincipals.length > 1 ? "s" : ""} ${s.vicePrincipals.join(", ")}` : "";
    pts.push({
      title: "Leadership",
      text: `Pray for the principal, ${s.principal}${vps} — wisdom, integrity, rest, and a heart for every child in their care.`,
    });
  } else {
    pts.push({ title: "Leadership", text: "Pray for the principal and school leaders — wisdom, integrity and rest." });
  }

  pts.push({
    title: "Teachers & staff",
    text: "Pray for teachers, allied educators, counsellors and support staff: strength for long days, joy in the work, and protection from burnout.",
  });

  if (isPrimary(s)) {
    pts.push({
      title: "The children",
      text: "Pray that the children grow in curiosity, kindness and confidence; that each one is seen and loved, and that none is left behind.",
    });
    pts.push({
      title: "PSLE & pressure",
      text: "Pray for peace over P5–P6 pupils and their families facing the PSLE — that worth is not measured by grades.",
    });
  } else if (isSecondary(s)) {
    pts.push({
      title: "The students",
      text: "Pray for teenagers forming their identity: good friendships, protection from bullying and harmful content online, and mental and emotional health.",
    });
    pts.push({
      title: "National exams",
      text: "Pray for students preparing for national exams — diligence without anxiety, and wisdom in choosing their next path.",
    });
  } else if (isJC(s)) {
    pts.push({
      title: "The students",
      text: "Pray for young adults stepping toward university, NS and work: purpose, perseverance, and freedom from the weight of comparison.",
    });
  } else {
    pts.push({
      title: "The students",
      text: `Pray for ${students} at every level here — that they flourish in body, mind and spirit.`,
    });
  }

  pts.push({
    title: "Families",
    text: "Pray for parents and caregivers — strong homes, open communication, and provision for families who are struggling.",
  });

  // What the school is known for.
  const known = [];
  for (const d of s.distinctive ?? []) known.push(d.title);
  if (known.length) {
    pts.push({
      title: "Its gifts",
      text: `Give thanks for what God has placed here (${known.join("; ")}) and pray these become blessings to the wider community.`,
    });
  }
  if (s.sap) {
    pts.push({ title: "Heritage", text: "As a SAP school, pray that bilingual and bicultural strengths build bridges across Singapore's communities." });
  }
  if (s.ip || s.gifted) {
    pts.push({ title: "High expectations", text: "Pray for humility and rest among high-achieving students, and that gifts are used to serve others." });
  }

  pts.push({
    title: "Christian witness",
    text: "Pray for Christian teachers, students and any school fellowship — to be salt and light with gentleness and respect.",
  });

  if (s.area) {
    pts.push({
      title: "The neighbourhood",
      text: `Pray for ${s.area}: the estates around this school, and churches nearby who can bless it.`,
    });
  }
  return pts;
}

// Short labels for what the school is known for (shown in the detail panel).
export function knownFor(s) {
  const tags = [];
  if (s.sap) tags.push("SAP school");
  if (s.ip) tags.push("Integrated Programme");
  if (s.gifted) tags.push("Gifted Education Programme");
  if (s.autonomous) tags.push("Autonomous school");
  if (s.nature && !/co-ed/i.test(s.nature)) tags.push(s.nature);
  if (s.type && !/government school/i.test(s.type)) tags.push(s.type);
  return tags;
}
