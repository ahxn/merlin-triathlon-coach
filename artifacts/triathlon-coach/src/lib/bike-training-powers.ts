type BikePowerZoneDefinition = {
  id: string;
  label: string;
  percentRange: string;
  lowerPercent?: number;
  upperPercent?: number;
  openEnded?: "below" | "above";
};

const bikePowerZoneDefinitions: BikePowerZoneDefinition[] = [
  { id: "z1", label: "Active recovery", percentRange: "<55% FTP", upperPercent: 0.55, openEnded: "below" },
  { id: "z2", label: "Endurance", percentRange: "56–75% FTP", lowerPercent: 0.56, upperPercent: 0.75 },
  { id: "z3", label: "Tempo", percentRange: "76–90% FTP", lowerPercent: 0.76, upperPercent: 0.9 },
  { id: "z4", label: "Threshold", percentRange: "91–105% FTP", lowerPercent: 0.91, upperPercent: 1.05 },
  { id: "z5", label: "VO₂ max", percentRange: "106–120% FTP", lowerPercent: 1.06, upperPercent: 1.2 },
  { id: "z6", label: "Anaerobic capacity", percentRange: "121–150% FTP", lowerPercent: 1.21, upperPercent: 1.5 },
  { id: "z7", label: "Neuromuscular power", percentRange: ">150% FTP", lowerPercent: 1.5, openEnded: "above" },
];

export function getBikeTrainingPowerZones(ftpWatts: number | null | undefined) {
  const validFtp = ftpWatts && Number.isFinite(ftpWatts) && ftpWatts >= 50 && ftpWatts <= 1000 ? ftpWatts : null;
  return bikePowerZoneDefinitions.map((zone) => {
    let formatted = "—";
    if (validFtp !== null && zone.openEnded === "below") formatted = `<${Math.round(validFtp * (zone.upperPercent ?? 0))} W`;
    else if (validFtp !== null && zone.openEnded === "above") formatted = `>${Math.round(validFtp * (zone.lowerPercent ?? 0))} W`;
    else if (validFtp !== null) formatted = `${Math.round(validFtp * (zone.lowerPercent ?? 0))}–${Math.round(validFtp * (zone.upperPercent ?? 0))} W`;
    return { ...zone, formatted };
  });
}
