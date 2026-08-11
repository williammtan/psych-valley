/**
 * The cast. Names, colours and journal blurbs live here so dialogue, the
 * journal and the map all agree on who someone is.
 */
export interface Person {
  id: string;
  name: string;
  role: string;
  /** Name-plate tint; matches the character's garment ramp highlight. */
  color: number;
  blurb: string;
}

export const PEOPLE: Record<string, Person> = {
  player: { id: 'player', name: '', role: 'Newcomer', color: 0x95d0b3, blurb: 'You.' },
  narrator: { id: 'narrator', name: '', role: '', color: 0xd8c69c, blurb: '' },
  sera: {
    id: 'sera', name: 'Sera', role: 'Researcher',
    color: 0x92b6c6,
    blurb: 'Keeps a field notebook she never lets anyone read. Asks "what did you notice?" more than she answers.',
  },
  mira: {
    id: 'mira', name: 'Mira', role: 'Innkeeper',
    color: 0xe0949a,
    blurb: 'Runs the Lantern Inn. Knows everyone in the valley and most of what they would rather she did not.',
  },
  oren: {
    id: 'oren', name: 'Oren', role: 'Courier',
    color: 0xb3be7e,
    blurb: 'Proud of never making a mistake. Currently making a lot of them, and hating it.',
  },
  tavi: {
    id: 'tavi', name: 'Tavi', role: 'Festival favourite',
    color: 0xf5bd77,
    blurb: 'Certain about everything. Not unkind — just louder than doubt.',
  },
  nia: {
    id: 'nia', name: 'Nia', role: 'Quiet resident',
    color: 0x96a7cc,
    blurb: 'Notices more than she says. Says it anyway, eventually.',
  },
  elia: {
    id: 'elia', name: 'Mayor Elia', role: 'Festival organiser',
    color: 0xc09acc,
    blurb: 'Has a clipboard, a schedule, and no expectation that either will survive the evening.',
  },
  pip: {
    id: 'pip', name: 'Pip', role: 'Cat',
    color: 0xffb937,
    blurb: 'Mira\'s cat. Currently afraid of a bell that has never hurt him.',
  },
  mote: {
    id: 'mote', name: 'Mote', role: '?',
    color: 0x8ce6e6,
    blurb: 'Found near the shrine road. Does not speak. Watches everything.',
  },
  villager_a: { id: 'villager_a', name: 'Bram', role: 'Farmer', color: 0xa69fb8, blurb: 'Grows more turnips than the valley needs.' },
  villager_b: { id: 'villager_b', name: 'Hesta', role: 'Baker', color: 0xa69fb8, blurb: 'Up before the bell, every day.' },
  villager_c: { id: 'villager_c', name: 'Dov', role: 'Fisher', color: 0xa69fb8, blurb: 'Claims the river has changed. Nobody has checked.' },
  villager_d: { id: 'villager_d', name: 'Wren-of-the-Hill', role: 'Shepherd', color: 0xa69fb8, blurb: 'Two of her sheep have started walking in circles.' },
  villager_e: { id: 'villager_e', name: 'Tomas', role: 'Storekeeper', color: 0xa69fb8, blurb: 'Sells everything. Recommends nothing.' },
  villager_f: { id: 'villager_f', name: 'Isolde', role: 'Musician', color: 0xa69fb8, blurb: 'Tuning for the festival. Has been for three days.' },
};

export function personName(id: string): string {
  return PEOPLE[id]?.name ?? id;
}
