'use strict';

const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

const DEFAULT_GSM = 150;
const DEFAULT_KG_CO2E_PER_KG = 3.5;
const CO2E_SOURCE = {
  citation: 'Surinder, S. (2015). Sustainable supply chain in the textile industry. Master’s thesis, TU Wien: the case-study cotton supply chain produces 3.5 kg CO2e per kg of finished cotton fabric.',
  url: 'https://repositum.tuwien.at/handle/20.500.12708/4130',
};

/**
 * Convert measured cut area into fabric mass and an avoided-virgin-fabric
 * estimate. Only the area is measured; fabric weight and the emission factor
 * are stated assumptions that callers can replace with their own values.
 */
function estimateImpact(usedAreaCm2, overrides = {}) {
  const fabricGsm = overrides.fabricGsm ?? DEFAULT_GSM;
  const kgCo2ePerKg = overrides.kgCo2ePerKg ?? DEFAULT_KG_CO2E_PER_KG;
  const areaM2 = usedAreaCm2 / 10000, massKg = areaM2 * fabricGsm / 1000;
  return {
    fabricReusedCm2: round(usedAreaCm2, 1),
    fabricReusedM2: round(areaM2, 4),
    estimatedMassG: round(massKg * 1000, 1),
    avoidedVirginFabric: {
      kgCo2e: round(massKg * kgCo2ePerKg, 3),
      waterLitres: overrides.waterLitresPerKg === undefined ? null : round(massKg * overrides.waterLitresPerKg, 1),
    },
    assumptions: {
      fabricGsm, fabricGsmSource: overrides.fabricGsm === undefined ? `Assumed ${DEFAULT_GSM} g/m², a mid-weight woven cotton. Weigh a known area of your fabric for a better value.` : 'Supplied by the request.',
      kgCo2ePerKg, emissionFactorSource: overrides.kgCo2ePerKg === undefined ? CO2E_SOURCE : { citation: 'Supplied by the request.' },
      waterLitresPerKg: overrides.waterLitresPerKg ?? null,
      waterNote: overrides.waterLitresPerKg === undefined ? 'Published water footprints for cotton fabric vary by more than an order of magnitude with system boundaries, so no default is applied. Supply waterLitresPerKg to estimate it.' : 'Supplied by the request.',
    },
    limitations: [
      'Fabric area is measured from the planned cuts, including seam allowances. Mass depends on the assumed fabric weight.',
      'Avoided impact assumes the project replaces buying the same mass of new cotton fabric; it is an estimate, not a verified saving.',
      'Emission factors differ between studies, fibres, and supply chains.',
    ],
  };
}

module.exports = { estimateImpact, DEFAULT_GSM, DEFAULT_KG_CO2E_PER_KG, CO2E_SOURCE };
