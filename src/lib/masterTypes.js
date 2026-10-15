// The lists shown on the Master Data screen. memberColumn = where members store the chosen value.
export const MASTER_TYPES = [
  { key: "state", label: "States", one: "State", hi: "राज्य", memberColumn: "state", slugValue: true },
  { key: "district", label: "Districts", one: "District", hi: "जिला", memberColumn: "district", slugValue: true, parent: "state" },
  { key: "relation", label: "Relations", one: "Relation", hi: "संबंध (वारिस)", memberColumn: "guardian_relation" },
  { key: "caste", label: "Castes", one: "Caste", hi: "जाति", memberColumn: "jati" },
  { key: "gotra", label: "Gotras", one: "Gotra", hi: "गोत्र", memberColumn: "gotra" },
];
export const masterType = (key) => MASTER_TYPES.find((t) => t.key === key) || null;
