/* -------------------------------------------------------- 3D colour themes */
/* One hue per tool, taken from the README badges; neutrals lean towards the AlmaLinux navy. */
const PALETTE = {
  light: {
    bg: ['#F3F6FA', '#DAE2EC'],
    grid: ['#1B2744', 0.085],
    shadow: 0.2,
    ink: '#1B2744', inkAlpha: 0.42, printAlpha: 0.78,
    region: '#D2DBE6', vpc: '#DFE6EF', subnet: '#EDF1F6', pad: '#DFE6EF',
    chassis: '#2B3448', alma: '#1E3A8A', base: '#A7B3C4',
    vox: '#F59E0B', voxDeep: '#DB8207', voxPale: '#FBD58A', secret: '#2B3448',
    condor: '#0E7490', condorLight: '#27A0BD', condorPale: '#CBE7EE',
    tofu: '#844FBA', ansible: '#EE0000', out: '#66748E',
    glass: '#3D5CA6', glassAlpha: 0.11, rail: '#3D5CA6', steel: '#77849A', ghost: '#5D6B86',
    job: '#4FBBD4', jobAlt: '#7DD1E3', ok: '#19B36B', bad: '#E5352B', off: '#465069', port: '#11182A',
    hemi: ['#FFFFFF', '#B5C2D6', 0.8], sun: 0.92,
    label: { card: 'rgba(255,255,255,.94)', border: 'rgba(27,39,68,.22)', text: '#141C2E', sub: '#48546E',
      halo: 'rgba(243,246,250,.92)', leader: 'rgba(27,39,68,.45)' },
  },
  dark: {
    bg: ['#0C1322', '#070B15'],
    grid: ['#A0B9F0', 0.07],
    shadow: 0.42,
    ink: '#B9CBF2', inkAlpha: 0.4, printAlpha: 0.82,
    region: '#151E33', vpc: '#1B2740', subnet: '#23314F', pad: '#1B2740',
    chassis: '#4A5876', alma: '#3059CF', base: '#7E8DA8',
    vox: '#F7A823', voxDeep: '#D98510', voxPale: '#FFD98C', secret: '#E3EAF8',
    condor: '#149DBB', condorLight: '#3CC0DC', condorPale: '#2B4A63',
    tofu: '#A46FE0', ansible: '#FF4040', out: '#8E9DBC',
    glass: '#86A6FF', glassAlpha: 0.09, rail: '#7F9FF5', steel: '#8A99B8', ghost: '#8E9DBC',
    job: '#6FD6EC', jobAlt: '#A4E6F4', ok: '#2FD98B', bad: '#FF5247', off: '#2A3550', port: '#05080F',
    hemi: ['#C9D6F5', '#0A1020', 0.62], sun: 0.85,
    label: { card: 'rgba(15,22,39,.93)', border: 'rgba(170,192,240,.28)', text: '#EAF0FB', sub: '#A6B4D2',
      halo: 'rgba(9,14,26,.9)', leader: 'rgba(185,203,242,.5)' },
  },
};

/** Legend entries: the five traffic flows, in pipeline order. */
const FLOWS = [
  { id: 'tofu', key: 'tofu', name: 'OpenTofu', what: 'AWS API', chip: 'OpenTofu → AWS API', buildTime: true },
  { id: 'ssh', key: 'ansible', name: 'Ansible', what: 'SSH 22', chip: '22 · SSH bootstrap', buildTime: true },
  { id: 'vox', key: 'vox', name: 'OpenVox', what: '8140', chip: '8140 · catalogs' },
  { id: 'condor', key: 'condor', name: 'HTCondor', what: '9618', chip: '9618 · jobs, slot ads' },
  { id: 'out', key: 'out', name: 'Outbound', what: 'all', chip: 'all · outbound' },
];
