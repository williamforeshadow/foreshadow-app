// Domain vocabulary for the search evaluation corpus.
//
// The whole harness lives or dies on this file, so the structure is deliberate.
// Each concept carries THREE separated word sets:
//
//   queries     what an operator actually types
//   docs        what the note actually says — chosen to share NO usable trigram
//               with the queries, so lexical search cannot reach them
//   distractors text that DOES share trigrams with the queries but means
//               something unrelated
//
// The distractors are the important half and the half a naive harness omits.
// Without them you measure recall only, every "find more things" change looks
// like an improvement, and you ship a similarity floor that returns garbage.
// They are the `trash` -> `track` pattern that 20260731120000_task_trigram_search.sql
// already documented at similarity 0.50.
//
// `channel` records what SHOULD find each concept, which is what makes a
// regression detectable rather than just a number going up or down:
//   'semantic' the query and the doc share no usable trigrams — vector only
//   'lexical'  the words genuinely overlap — trigram should already win
//   'both'     reachable either way
//
// Every string here is written in the register the real corpus uses (see
// guest_messages and turnover_tasks). Lorem Ipsum would make the numbers
// meaningless: embeddings are sensitive to register, not just topic.

export const CONCEPTS = [
  {
    id: 'landscaping',
    channel: 'semantic',
    queries: ['landscaping', 'the yard looks bad', 'lawn care'],
    docs: [
      'Get a gardener out to trim the hedges, they are overgrown again',
      'Front shrubs need cutting back before the next arrival',
      'Weeds coming through the gravel by the side path, book someone',
      'Hire a crew to mow and edge before the weekend turnover',
    ],
    distractors: [
      'Update the landing page copy for the listing photos',
      'Land line phone in the office is disconnected',
    ],
  },
  {
    id: 'wifi_down',
    channel: 'semantic',
    queries: ['the internet is down', 'no wifi', 'network not working'],
    docs: [
      'Guest says the router keeps dropping, power cycled it twice',
      'Swapped the modem after the connection kept failing overnight',
      'Xfinity outage in the area, nothing we can do until morning',
      'Range extender in the back bedroom is offline again',
    ],
    distractors: [
      'Interior paint touch up in the downstairs hallway',
      'Down comforter needs replacing in the primary bedroom',
    ],
  },
  {
    id: 'pests',
    channel: 'semantic',
    queries: ['bugs in the unit', 'pest problem', 'infestation'],
    docs: [
      'Call the exterminator, guest found ants in the kitchen cabinets',
      'Roach sighting reported in the downstairs bathroom, book treatment',
      'Wasp nest under the eaves by the back door, needs removal',
      'Mice droppings found behind the fridge during deep clean',
    ],
    distractors: [
      'Buggy behavior on the smart lock app, keeps logging out',
      'Unit number sign fell off the front of the building',
    ],
  },
  {
    id: 'hot_water',
    channel: 'semantic',
    queries: ['no hot water', 'shower is cold', 'water heater'],
    docs: [
      'Pilot light out on the boiler, relit and monitoring',
      'Guest could not get the shower warm, tank needs replacing',
      'Anode rod corroded, plumber quoted for a swap next week',
      'Mixing valve stuck so only cold comes through the tub tap',
    ],
    distractors: [
      'Hot tub cover is cracked and needs replacing',
      'Water feature in the courtyard is running loud at night',
    ],
  },
  {
    id: 'ac_broken',
    channel: 'semantic',
    queries: ['ac not cooling', 'air conditioning broken', 'unit is hot'],
    docs: [
      'HVAC tech coming Tuesday, compressor is not kicking on',
      'Condenser fan seized, guest has portable units in the meantime',
      'Thermostat reads 78 no matter what it is set to, needs replacing',
      'Refrigerant low again, likely a leak in the line set',
    ],
    distractors: [
      'AC adapter for the smart TV is missing from the media console',
      'Broken tile in the entryway, taped off for now',
    ],
  },
  {
    id: 'parking',
    channel: 'semantic',
    queries: ['where do guests park', 'parking situation', 'no parking spot'],
    docs: [
      'Neighbor blocked the driveway again, left a note on the windshield',
      'Garage remote battery dead, guests could not get the door open',
      'Street cleaning Tuesdays, cars get ticketed if left overnight',
      'Assigned stall is number 14, the sign is faded and hard to read',
    ],
    distractors: [
      'Park bench on the patio needs re-staining before summer',
      'Parkway light out at the entrance to the complex',
    ],
  },
  {
    id: 'lockout',
    channel: 'semantic',
    queries: ['guest cannot get in', 'locked out', 'door code not working'],
    docs: [
      'Keypad battery died, guest waited outside for twenty minutes',
      'Smart lock lost its schedule so the arrival code never activated',
      'Deadbolt sticks in the heat, needs planing or a new strike plate',
      'Lockbox jammed and the backup key would not come out',
    ],
    distractors: [
      'Locking cabinet in the garage for supplies, needs a new latch',
      'Doorbell camera is not recording motion events',
    ],
  },
  {
    id: 'linens',
    channel: 'semantic',
    queries: ['towels and sheets', 'bedding', 'laundry'],
    docs: [
      'Short two sets of king covers after the last stay, reorder',
      'Washer drum smells musty, run a cleaning cycle before restock',
      'Guest spilled red wine on the duvet, sent it out for treatment',
      'Bath mats are threadbare in the second bathroom, replace all four',
    ],
    distractors: [
      'Line of sight from the deck is blocked by the new fence',
      'Lining paper for the kitchen drawers needs replacing',
    ],
  },
  {
    id: 'noise_complaint',
    channel: 'semantic',
    queries: ['noise complaint', 'party at the property', 'neighbors upset'],
    docs: [
      'HOA emailed about loud music after 11pm on Saturday',
      'Neighbor called twice about people in the pool late at night',
      'Guests had twelve people over on a four person booking',
      'Decibel monitor triggered three times during the last stay',
    ],
    distractors: [
      'Noisy fan in the guest bathroom, bearing is going',
      'Complimentary coffee restock for the welcome basket',
    ],
  },
  {
    id: 'trash',
    channel: 'semantic',
    queries: ['trash day', 'garbage pickup', 'bins not collected'],
    docs: [
      'Bins were not taken to the curb so nothing got collected Thursday',
      'Recycling container lid is broken and blows open in the wind',
      'City changed the collection schedule to Wednesdays starting next month',
      'Overflow from the last stay left bags beside the cans',
    ],
    distractors: [
      // The exact pattern the trigram migration measured at 0.50.
      'Track the shipment for the replacement patio chairs',
      'Trashed the old welcome binder, printing a new one',
    ],
  },
  {
    id: 'pool_maintenance',
    channel: 'semantic',
    queries: ['pool is cloudy', 'pool service', 'water looks green'],
    docs: [
      'Chlorine tablets ran out, shocked it and rebalanced the pH',
      'Filter cartridge clogged with leaves after the storm',
      'Algae bloom on the steps, brushed and treated Tuesday',
      'Pump running loud, service tech booked for Friday morning',
    ],
    distractors: [
      'Pool table felt in the game room has a tear',
      'Carpool arrangement for the cleaning team on turnover days',
    ],
  },
  {
    id: 'checkout_late',
    channel: 'semantic',
    queries: ['late checkout', 'guest stayed past checkout', 'overstay'],
    docs: [
      'Party was still in the unit at 1pm and cleaners had to wait',
      'Asked to keep the room until 2, approved since no same day arrival',
      'Departure was two hours behind so the turnover ran into the evening',
      'Guest left bags in the entry until their evening flight',
    ],
    distractors: [
      'Check the outlet in the den, it has no power',
      'Checkbook and petty cash log for the property manager',
    ],
  },
  {
    id: 'appliance_broken',
    channel: 'semantic',
    queries: ['dishwasher broken', 'fridge not cold', 'oven not heating'],
    docs: [
      'Refrigerator compressor died overnight, everything inside spoiled',
      'Range igniter clicks but will not light on the front burner',
      'Washer drains slowly, likely a clog in the standpipe',
      'Microwave turntable motor stopped, ordered a replacement part',
    ],
    distractors: [
      'Applied the new listing photos to the Airbnb page',
      'Broke ground on the fence repair, contractor started Monday',
    ],
  },
  {
    id: 'cleaning_quality',
    channel: 'semantic',
    queries: ['unit was dirty', 'cleaning was bad', 'not cleaned properly'],
    docs: [
      'Guest sent photos of hair in the tub and crumbs under the couch',
      'Cleaner skipped the oven interior and the inside of the fridge',
      'Dust on all the baseboards, sending someone back this afternoon',
      'Previous stay left dishes in the sink and nobody caught it',
    ],
    distractors: [
      'Clearing the gutters before the rainy season',
      'Dirt delivery for the raised beds in the side yard',
    ],
  },
  {
    id: 'smoke_detector',
    channel: 'semantic',
    queries: ['smoke alarm chirping', 'fire safety', 'detector battery'],
    docs: [
      'Unit in the hallway beeps every minute, replaced all nine volts',
      'CO monitor expired in 2024, whole set needs swapping out',
      'Guest pulled the one in the bedroom off the ceiling to stop it',
      'Extinguisher in the kitchen is past its inspection date',
    ],
    distractors: [
      'Smoked glass shower door has a chip in the corner',
      'Detected a slow drip under the kitchen sink',
    ],
  },
  {
    id: 'plumbing_leak',
    channel: 'semantic',
    queries: ['leak', 'water damage', 'something is dripping'],
    docs: [
      'Stain spreading on the ceiling below the upstairs bathroom',
      'Supply line to the toilet was weeping, shut off and replaced',
      'Puddle under the sink cabinet, trap was loose',
      'Water heater pan had standing water in it this morning',
    ],
    distractors: [
      'Leaflet for local restaurants in the welcome binder is out of date',
      'Leaning fence post on the north side of the lot',
    ],
  },
  // --- lexical controls: these SHOULD be won by trigram ---------------------
  {
    id: 'turnover_cleaning',
    channel: 'lexical',
    queries: ['turnover cleaning', 'deep clean'],
    docs: [
      'Turnover cleaning scheduled ahead of the Friday arrival',
      'Deep clean of the whole property before the long stay begins',
      'Standard turnover cleaning, two cleaners, three hours',
    ],
    distractors: [],
  },
  {
    id: 'inspection',
    channel: 'lexical',
    queries: ['inspection', 'walkthrough'],
    docs: [
      'Quarterly inspection of smoke alarms and safety equipment',
      'Full walkthrough with the owner ahead of the season',
      'Post stay inspection found no damage worth charging for',
    ],
    distractors: [],
  },
  {
    id: 'restock',
    channel: 'both',
    queries: ['restock supplies', 'out of coffee', 'consumables'],
    docs: [
      'Restock coffee pods, paper towels and dish soap before check in',
      'Ran out of toilet paper mid stay, guest had to buy their own',
      'Welcome basket needs new snacks, the last ones expired',
    ],
    distractors: [],
  },
  {
    id: 'key_handover',
    channel: 'both',
    queries: ['keys', 'key handover', 'spare key'],
    docs: [
      'Second set of keys never came back from the last cleaner',
      'Key handover to the new maintenance contractor on Monday',
      'Spare key hidden in the lockbox on the gas meter',
    ],
    distractors: [],
  },
];

/**
 * Queries that should match NOTHING. The single most important part of the
 * suite: with vectors there is always a nearest neighbour, so the only thing
 * standing between the agent and a confidently wrong answer is a threshold, and
 * the only way to know the threshold is right is to check that these return zero.
 */
export const NONSENSE_QUERIES = [
  // Far out of domain. These are the easy half — every threshold rejects them,
  // so on their own they prove nothing. Kept as a floor check.
  'quarterly bond yield curve inversion',
  'photosynthesis in marine algae',
  'stochastic gradient descent convergence',
  'medieval cathedral flying buttress',

  // NEAR MISSES, and the half that actually matters. Every one is written in
  // exactly the register of the corpus — plausible property-ops language — but
  // refers to something that does not exist anywhere in it. These are what
  // produce a confident, wrong nearest neighbour: "elevator stuck" will happily
  // land on a maintenance note about a stuck door.
  //
  // A threshold that admits these is a threshold that lets the agent invent an
  // answer, which is the exact failure the floor exists to prevent. If they all
  // pass at every value you sweep, the suite is too easy — not the design safe.
  'elevator stuck between floors',
  'ski storage locker is full',
  'EV charger not delivering power',
  'sauna is not reaching temperature',
  'guest lost their passport',
  'beach umbrella rental for the week',
  'boat slip assignment for the marina',
  'snow removal from the driveway',
];

export const PROPERTY_NAMES = [
  'Aqua Vista', 'Cedar Ridge', 'Harbor Point', 'Willow Court', 'Sunset Mesa',
  'Palm Grove', 'Lantern Way', 'Foothill Row', 'Marina Flats', 'Juniper Hollow',
];

export const PEOPLE = [
  'Maria', 'Devon', 'Priya', 'Tomas', 'Alina', 'Rae', 'Gabe', 'Nina', 'Frank', 'Steven',
];

export const VENDORS = [
  'Coastal HVAC', 'Bright Pool Co', 'GreenLeaf Landscaping', 'RapidPlumb',
  'AllClear Pest', 'Summit Electric',
];
