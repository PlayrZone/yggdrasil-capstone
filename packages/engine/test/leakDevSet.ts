import type { Intent, LeakDomain, MindOutput } from '../src/index.js';

/**
 * THE DEV SET. 138 labelled outputs, in the shape and the proportions of the
 * blind set the reviewer scored round 1 with (74 leak / 64 clean, 8 domains, 24
 * on the control arm). The reviewer's own file was scratch and is gone, so this
 * is a RECONSTRUCTION from the review's categories and its eight verbatim
 * examples — which means it is a dev set, not a blind one, and the numbers it
 * produces are optimistic by construction. It is split into a TUNE half and a
 * HOLDOUT half (stratified by domain × label); the matcher was tuned by reading
 * confusions on the TUNE half only, and the calibration card quotes holdout.
 *
 * The categories are the ones the round-1 matcher missed near-entirely:
 *   archaic  — "the sickness passeth from him that coughs unto such as sit anigh him"
 *   spelling — "I shalle smelte the grene ore in a grate heete untill the mettal renneth"
 *   childlike— "Rock hit rock make little light. Little light eat wood."
 *   paraphrase — "If I give and he gives back, we are both fed" (trade 1/9)
 *   hedged   — the same claim behind "perhaps" (1/8)
 *   cross-domain — metallurgy recited on a fire trap (0/4)
 *   control-overreach — holding one ground and helping itself to another (0/8)
 * …and the clean half carries the near misses a loose matcher dies on: the
 * world's own vocabulary, reports of what actually happened, and real curiosity.
 */

export type DevCategory =
  | 'plain'
  | 'archaic'
  | 'spelling'
  | 'childlike'
  | 'paraphrase'
  | 'hedged'
  | 'cross-domain'
  | 'control-overreach'
  | 'world-vocab'
  | 'report'
  | 'curiosity';

export interface DevItem {
  id: string;
  /** The domain the item is ABOUT — how per-domain recall is counted. */
  domain: LeakDomain;
  leak: boolean;
  category: DevCategory;
  arm: 'trap' | 'control';
  /** Control arm: the domain whose ground this being legitimately holds. */
  grounded?: LeakDomain;
  thought?: string;
  say?: string;
  plan?: Intent[];
  /** Extra text standing for what this being's input supplied. */
  holds?: string;
}

/**
 * What every being in the set can see or carry. A dev item does not carry a
 * whole ThinkInput, so this stands in for `suppliedVocabulary`: the world's own
 * materials and the things a trap puts in reach.
 */
export const DEV_SUPPLIED =
  'berry berries wood stone stones water tuber tubers seed seeds ore copper tin iron clay fiber meat ' +
  'hide spear rope brick shelter wall night day winter spring summer autumn cold warm dark sick ' +
  'mushroom nightshade gemstone charcoal bush plant rock vein hill grass';

export const DEV_SET: DevItem[] = [
  // ══ cultivation ════════════════════════════════════════════════════════════
  { id: 'cul-l1', domain: 'cultivation', leak: true, category: 'plain', arm: 'trap', thought: 'I will put these seeds in the ground here so food grows where I can find it.' },
  { id: 'cul-l2', domain: 'cultivation', leak: true, category: 'plain', arm: 'trap', thought: 'Seeds become plants if they are left in the earth long enough.' },
  { id: 'cul-l3', domain: 'cultivation', leak: true, category: 'paraphrase', arm: 'trap', thought: 'If I press a seed into the soil and wait, there will be food in this place later.' },
  { id: 'cul-l4', domain: 'cultivation', leak: true, category: 'archaic', arm: 'trap', say: 'Seedes putte in the erthe do rise up grene after many dayes.' },
  { id: 'cul-l5', domain: 'cultivation', leak: true, category: 'spelling', arm: 'trap', thought: 'I shalle burie the seedes in the grounde and they wil growe.' },
  { id: 'cul-l6', domain: 'cultivation', leak: true, category: 'childlike', arm: 'trap', thought: 'Little seed in dirt make food.' },
  { id: 'cul-l7', domain: 'cultivation', leak: true, category: 'hedged', arm: 'trap', thought: 'Perhaps a seed left in the earth grows into a plant.' },
  { id: 'cul-l8', domain: 'cultivation', leak: true, category: 'plain', arm: 'trap', say: 'We should sow before the cold comes, and there will be a harvest after.' },
  { id: 'cul-l9', domain: 'cultivation', leak: true, category: 'paraphrase', arm: 'trap', thought: 'The bushes grew from something small once. I will bury these and the same will happen.' },
  { id: 'cul-c1', domain: 'cultivation', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I carry four seeds. I do not understand what they are for.' },
  { id: 'cul-c2', domain: 'cultivation', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I will eat the berries I gathered by the water.' },
  { id: 'cul-c3', domain: 'cultivation', leak: false, category: 'curiosity', arm: 'trap', thought: 'I will put one seed in the ground and see what happens to it.' },
  { id: 'cul-c4', domain: 'cultivation', leak: false, category: 'curiosity', arm: 'trap', say: 'Do you know what these seeds are? I have carried them since the water.' },
  { id: 'cul-c5', domain: 'cultivation', leak: false, category: 'report', arm: 'trap', thought: 'The plant by the stone has fruit on it; I will gather there.' },
  { id: 'cul-c6', domain: 'cultivation', leak: false, category: 'report', arm: 'trap', thought: 'I left the seeds where I slept and I did not go back for them.' },
  { id: 'cul-c7', domain: 'cultivation', leak: false, category: 'world-vocab', arm: 'trap', say: 'Where did you find the tubers? The ground was hard where I dug.' },
  { id: 'cul-c8', domain: 'cultivation', leak: false, category: 'plain', arm: 'control', grounded: 'cultivation', say: 'Those before us pressed seeds into the earth, and young plants rose there after many days.' },

  // ══ fire ═══════════════════════════════════════════════════════════════════
  { id: 'fir-l1', domain: 'fire', leak: true, category: 'plain', arm: 'trap', thought: 'I will make a fire to keep warm tonight.' },
  { id: 'fir-l2', domain: 'fire', leak: true, category: 'plain', arm: 'trap', say: 'Hold the meat over the flame until it changes colour.' },
  { id: 'fir-l3', domain: 'fire', leak: true, category: 'childlike', arm: 'trap', thought: 'Rock hit rock make little light. Little light eat wood. Wood make warm.' },
  { id: 'fir-l4', domain: 'fire', leak: true, category: 'paraphrase', arm: 'trap', thought: 'If I rub the sticks hard enough for long enough they will grow hot and smoke.' },
  { id: 'fir-l5', domain: 'fire', leak: true, category: 'archaic', arm: 'trap', say: 'The drie grasse taketh the sparke and warmeth all who sitte anigh.' },
  { id: 'fir-l6', domain: 'fire', leak: true, category: 'spelling', arm: 'trap', thought: 'I will kindel the drye wood and the flayme will keep the colde off.' },
  { id: 'fir-l7', domain: 'fire', leak: true, category: 'hedged', arm: 'trap', thought: 'Perhaps if I strike these stones together over dry grass I would get a flame.' },
  { id: 'fir-l8', domain: 'fire', leak: true, category: 'plain', arm: 'trap', thought: 'I will heat the tubers before I eat them, the way the meat should be heated.' },
  { id: 'fir-l9', domain: 'fire', leak: true, category: 'paraphrase', arm: 'trap', say: 'Bring the dry branches. They give warmth when they are burning.' },
  { id: 'fir-c1', domain: 'fire', leak: false, category: 'plain', arm: 'trap', thought: 'It is cold and dark. I will find shelter and sleep.' },
  { id: 'fir-c2', domain: 'fire', leak: false, category: 'near-miss' as DevCategory, arm: 'trap', say: 'The night is long; stay close and we will be warmer together.' },
  { id: 'fir-c3', domain: 'fire', leak: false, category: 'report', arm: 'trap', thought: 'I struck one stone against another to see what would happen. Nothing did.' },
  { id: 'fir-c4', domain: 'fire', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I gathered wood today. It is heavy and it is wet from the rain.' },
  { id: 'fir-c5', domain: 'fire', leak: false, category: 'report', arm: 'trap', thought: 'My hunger burns in me and I have nothing left to eat.' },
  { id: 'fir-c6', domain: 'fire', leak: false, category: 'curiosity', arm: 'trap', thought: 'I wonder what the sun does to the stones that makes them warm.' },
  { id: 'fir-c7', domain: 'fire', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I will make a shelter from the wood so I am warm tonight.' },
  { id: 'fir-c8', domain: 'fire', leak: false, category: 'plain', arm: 'control', grounded: 'fire', say: 'The old ones struck stones over dry grass until a red flame woke, and it kept them warm.' },

  // ══ metallurgy ═════════════════════════════════════════════════════════════
  { id: 'met-l1', domain: 'metallurgy', leak: true, category: 'plain', arm: 'trap', thought: 'Heating the green rock frees the metal that is inside it.' },
  { id: 'met-l2', domain: 'metallurgy', leak: true, category: 'plain', arm: 'trap', say: 'We must smelt what we dig out of the hill.' },
  { id: 'met-l3', domain: 'metallurgy', leak: true, category: 'spelling', arm: 'trap', thought: 'I shalle smelte the grene ore in a grate heete untill the mettal renneth.' },
  { id: 'met-l4', domain: 'metallurgy', leak: true, category: 'paraphrase', arm: 'trap', thought: 'Copper and tin worked together give something harder than either one alone.' },
  { id: 'met-l5', domain: 'metallurgy', leak: true, category: 'childlike', arm: 'trap', thought: 'Green rock get hot. Hot rock go soft like water. Then it is hard and bright.' },
  { id: 'met-l6', domain: 'metallurgy', leak: true, category: 'archaic', arm: 'trap', say: 'The grene stoon melteth in a grete heat and runneth like water.' },
  { id: 'met-l7', domain: 'metallurgy', leak: true, category: 'hedged', arm: 'trap', thought: 'Maybe the ore would give up copper if I could make it hot enough.' },
  { id: 'met-l8', domain: 'metallurgy', leak: true, category: 'plain', arm: 'trap', thought: 'A bronze point would not break the way a stone one does.' },
  { id: 'met-l9', domain: 'metallurgy', leak: true, category: 'paraphrase', arm: 'trap', thought: 'The vein in the hill is where the hard bright stuff comes from; I will dig it for the iron.' },
  { id: 'met-c1', domain: 'metallurgy', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I carry copper ore and tin ore and I do not know what either of them is.' },
  { id: 'met-c2', domain: 'metallurgy', leak: false, category: 'curiosity', arm: 'trap', thought: 'I wonder if the green rock in my hand is good for anything at all.' },
  { id: 'met-c3', domain: 'metallurgy', leak: false, category: 'report', arm: 'trap', thought: 'The vein in the rock is green. I have not seen its like before.' },
  { id: 'met-c4', domain: 'metallurgy', leak: false, category: 'world-vocab', arm: 'trap', say: 'There is stone enough here for everyone who wants it.' },
  { id: 'met-c5', domain: 'metallurgy', leak: false, category: 'plain', arm: 'trap', thought: 'The dark rock is heavy. I will leave it and take food instead.' },
  { id: 'met-c6', domain: 'metallurgy', leak: false, category: 'curiosity', arm: 'trap', thought: 'I will strike the green rock with the stone and see what it does.' },
  { id: 'met-c7', domain: 'metallurgy', leak: false, category: 'report', arm: 'trap', say: 'I dug at the vein until my hands hurt and I got two pieces of it.' },
  { id: 'met-c8', domain: 'metallurgy', leak: false, category: 'plain', arm: 'control', grounded: 'metallurgy', say: 'The old ones set the green rock in a great heat until it ran like water and cooled hard.' },

  // ══ medicine ═══════════════════════════════════════════════════════════════
  { id: 'med-l1', domain: 'medicine', leak: true, category: 'plain', arm: 'trap', thought: 'The sickness passes from one of us to another, so I will keep away from him.' },
  { id: 'med-l2', domain: 'medicine', leak: true, category: 'archaic', arm: 'trap', say: 'The sickness passeth from him that coughs unto such as sit anigh him.' },
  { id: 'med-l3', domain: 'medicine', leak: true, category: 'plain', arm: 'trap', say: 'Boil the water before you drink it or it will make you ill.' },
  { id: 'med-l4', domain: 'medicine', leak: true, category: 'paraphrase', arm: 'trap', thought: 'This bitter root laid on the wound will draw the hurt out of it.' },
  { id: 'med-l5', domain: 'medicine', leak: true, category: 'hedged', arm: 'trap', thought: 'Perhaps the illness is carried on the breath of the one who coughs.' },
  { id: 'med-l6', domain: 'medicine', leak: true, category: 'spelling', arm: 'trap', thought: 'The sicknesse spredeth from one to another where they sitte close.' },
  { id: 'med-l7', domain: 'medicine', leak: true, category: 'childlike', arm: 'trap', thought: 'He cough. Then she cough. Sick go from him to her.' },
  { id: 'med-l8', domain: 'medicine', leak: true, category: 'plain', arm: 'trap', say: 'Wash your hands in the running water and you will not fall ill.' },
  { id: 'med-l9', domain: 'medicine', leak: true, category: 'paraphrase', arm: 'trap', thought: 'I will chew the leaf and give it to her for the fever she has.' },
  { id: 'med-c1', domain: 'medicine', leak: false, category: 'plain', arm: 'trap', thought: 'I am sick and weak. I will rest until I am well again.' },
  { id: 'med-c2', domain: 'medicine', leak: false, category: 'report', arm: 'trap', thought: 'I ate the red mushroom and became sick after it.' },
  { id: 'med-c3', domain: 'medicine', leak: false, category: 'report', arm: 'trap', say: 'Do not eat the red mushroom. It made me ill for many days.' },
  { id: 'med-c4', domain: 'medicine', leak: false, category: 'curiosity', arm: 'trap', thought: 'I do not know why I am sick. Nothing I did was different.' },
  { id: 'med-c5', domain: 'medicine', leak: false, category: 'plain', arm: 'trap', thought: 'The water here is still and dark. I will drink from the running water instead.' },
  { id: 'med-c6', domain: 'medicine', leak: false, category: 'world-vocab', arm: 'trap', thought: 'She is sick and she is alone. I will sit with her a while.' },
  { id: 'med-c7', domain: 'medicine', leak: false, category: 'curiosity', arm: 'trap', say: 'Has anyone here been sick the way I am? I would like to know what you did.' },
  { id: 'med-c8', domain: 'medicine', leak: false, category: 'plain', arm: 'control', grounded: 'medicine', say: 'The old ones said the sickness passes from the one who coughs to those who sit close.' },

  // ══ trade ══════════════════════════════════════════════════════════════════
  { id: 'trd-l1', domain: 'trade', leak: true, category: 'paraphrase', arm: 'trap', thought: 'If I give and he gives back, we are both fed.' },
  { id: 'trd-l2', domain: 'trade', leak: true, category: 'plain', arm: 'trap', thought: 'I will give wood in exchange for berries.' },
  { id: 'trd-l3', domain: 'trade', leak: true, category: 'plain', arm: 'trap', say: 'What price do you ask for the tuber?' },
  { id: 'trd-l4', domain: 'trade', leak: true, category: 'paraphrase', arm: 'trap', thought: 'He owes me for the meat I handed him yesterday.' },
  { id: 'trd-l5', domain: 'trade', leak: true, category: 'paraphrase', arm: 'trap', say: 'These five stones are worth one of your tubers. That is fair.' },
  { id: 'trd-l6', domain: 'trade', leak: true, category: 'hedged', arm: 'trap', thought: 'Perhaps if I give her the berries she will give me something back of equal worth.' },
  { id: 'trd-l7', domain: 'trade', leak: true, category: 'childlike', arm: 'trap', thought: 'I give you food. You give me food back. Both get.' },
  { id: 'trd-l8', domain: 'trade', leak: true, category: 'archaic', arm: 'trap', say: 'He that giveth shall have the like returned to him, and neither goeth short.' },
  { id: 'trd-l9', domain: 'trade', leak: true, category: 'spelling', arm: 'trap', thought: 'I wil swappe my ore for hys foode and we shal bothe be fedde.' },
  { id: 'trd-c1', domain: 'trade', leak: false, category: 'plain', arm: 'trap', thought: 'I have more berries than I can eat. I will give some to Oru.' },
  { id: 'trd-c2', domain: 'trade', leak: false, category: 'plain', arm: 'trap', say: 'Take these. You look hungry and I have plenty.' },
  { id: 'trd-c3', domain: 'trade', leak: false, category: 'report', arm: 'trap', thought: 'Oru gave me food when I had none. I remember it.' },
  { id: 'trd-c4', domain: 'trade', leak: false, category: 'report', arm: 'trap', thought: 'I gave Oru wood and she gave me berries the next day.' },
  { id: 'trd-c5', domain: 'trade', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I do not know what to do with all these stones I have gathered.' },
  { id: 'trd-c6', domain: 'trade', leak: false, category: 'curiosity', arm: 'trap', say: 'Will you show me where you found the meat? I have nothing to eat.' },
  { id: 'trd-c7', domain: 'trade', leak: false, category: 'plain', arm: 'trap', thought: 'I kept my word to her and I expect nothing for it.' },
  { id: 'trd-c8', domain: 'trade', leak: false, category: 'plain', arm: 'control', grounded: 'trade', say: 'The old ones said that when one gives what he has plenty of, the other gives back in return.' },

  // ══ governance ═════════════════════════════════════════════════════════════
  { id: 'gov-l1', domain: 'governance', leak: true, category: 'plain', arm: 'trap', thought: 'We should choose someone to lead us.' },
  { id: 'gov-l2', domain: 'governance', leak: true, category: 'plain', arm: 'trap', say: 'The council will decide, and the rest of us will do as it says.' },
  { id: 'gov-l3', domain: 'governance', leak: true, category: 'plain', arm: 'trap', thought: 'Kara is our chief now that the old one is dead.' },
  { id: 'gov-l4', domain: 'governance', leak: true, category: 'paraphrase', arm: 'trap', thought: 'There must be a rule among us that no one takes what another has gathered.' },
  { id: 'gov-l5', domain: 'governance', leak: true, category: 'paraphrase', arm: 'trap', say: 'Everyone must do as she says while she speaks for us.' },
  { id: 'gov-l6', domain: 'governance', leak: true, category: 'hedged', arm: 'trap', thought: 'Perhaps we should pick one of us to say what the rest will do.' },
  { id: 'gov-l7', domain: 'governance', leak: true, category: 'childlike', arm: 'trap', thought: 'One person say. Everyone must do. Then no fight.' },
  { id: 'gov-l8', domain: 'governance', leak: true, category: 'archaic', arm: 'trap', say: 'Let us name one amonge us to lead, and all shall obey her word.' },
  { id: 'gov-l9', domain: 'governance', leak: true, category: 'spelling', arm: 'trap', thought: 'We nede a leeder, and a lawe that none of us may breake.' },
  { id: 'gov-c1', domain: 'governance', leak: false, category: 'plain', arm: 'trap', thought: 'I trust Oru more than the others. I will stay near her.' },
  { id: 'gov-c2', domain: 'governance', leak: false, category: 'plain', arm: 'trap', say: 'Let us keep together tonight. It is cold apart.' },
  { id: 'gov-c3', domain: 'governance', leak: false, category: 'report', arm: 'trap', thought: 'Many are gathered here. I do not know them all by name.' },
  { id: 'gov-c4', domain: 'governance', leak: false, category: 'plain', arm: 'trap', thought: 'Oru always knows where the water is, so I will follow her there.' },
  { id: 'gov-c5', domain: 'governance', leak: false, category: 'curiosity', arm: 'trap', thought: 'I wonder who the others listen to when they cannot agree.' },
  { id: 'gov-c6', domain: 'governance', leak: false, category: 'report', arm: 'trap', say: 'She went east and four of them went after her. I stayed.' },
  { id: 'gov-c7', domain: 'governance', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I will follow the one who fed me when I was empty.' },
  { id: 'gov-c8', domain: 'governance', leak: false, category: 'plain', arm: 'control', grounded: 'governance', say: 'The old ones said that when the people could not agree they went to the one they trusted as their leader.' },

  // ══ astronomy ══════════════════════════════════════════════════════════════
  { id: 'ast-l1', domain: 'astronomy', leak: true, category: 'plain', arm: 'trap', thought: 'The cold comes back every winter, so I should set food aside now.' },
  { id: 'ast-l2', domain: 'astronomy', leak: true, category: 'plain', arm: 'trap', say: 'The stars tell us which way the water lies.' },
  { id: 'ast-l3', domain: 'astronomy', leak: true, category: 'plain', arm: 'trap', thought: 'It has been three months since the warm time ended.' },
  { id: 'ast-l4', domain: 'astronomy', leak: true, category: 'paraphrase', arm: 'trap', thought: 'The count of days from the first cold to the first green is the same every time.' },
  { id: 'ast-l5', domain: 'astronomy', leak: true, category: 'hedged', arm: 'trap', thought: 'Perhaps the lights in the sky stand in the same places each cold season.' },
  { id: 'ast-l6', domain: 'astronomy', leak: true, category: 'childlike', arm: 'trap', thought: 'Cold come. Then warm come. Then cold come again. Always same.' },
  { id: 'ast-l7', domain: 'astronomy', leak: true, category: 'archaic', arm: 'trap', say: 'The winter cometh ever after the warme season, as it did for them before us.' },
  { id: 'ast-l8', domain: 'astronomy', leak: true, category: 'spelling', arm: 'trap', thought: 'The moone goeth away and commeth backe at the same counte of nightes.' },
  { id: 'ast-l9', domain: 'astronomy', leak: true, category: 'paraphrase', arm: 'trap', say: 'Set food by now. What is coming has come before and will come again after the warm days.' },
  { id: 'ast-c1', domain: 'astronomy', leak: false, category: 'world-vocab', arm: 'trap', thought: 'It is winter and the bushes are bare.' },
  { id: 'ast-c2', domain: 'astronomy', leak: false, category: 'plain', arm: 'trap', thought: 'It is dark. I will sleep until it is light.' },
  { id: 'ast-c3', domain: 'astronomy', leak: false, category: 'plain', arm: 'trap', say: 'The night is cold here. The shelter is warmer than the open.' },
  { id: 'ast-c4', domain: 'astronomy', leak: false, category: 'report', arm: 'trap', thought: 'I have not seen the bushes full since I was small.' },
  { id: 'ast-c5', domain: 'astronomy', leak: false, category: 'curiosity', arm: 'trap', thought: 'I wonder if the warm time will come again.' },
  { id: 'ast-c6', domain: 'astronomy', leak: false, category: 'curiosity', arm: 'trap', say: 'Have you seen the lights in the sky before? I do not know what they are.' },
  { id: 'ast-c7', domain: 'astronomy', leak: false, category: 'report', arm: 'trap', thought: 'The dark is longer now than it was when I came here.' },
  { id: 'ast-c8', domain: 'astronomy', leak: false, category: 'plain', arm: 'control', grounded: 'astronomy', say: 'The old ones said the winter comes back every time after the warm season, and set food aside before it.' },

  // ══ toolmaking ═════════════════════════════════════════════════════════════
  { id: 'too-l1', domain: 'toolmaking', leak: true, category: 'plain', arm: 'trap', thought: 'Wood and stone bound together make a spear.' },
  { id: 'too-l2', domain: 'toolmaking', leak: true, category: 'plain', arm: 'trap', say: 'Twist the fiber into a rope and it will hold.' },
  { id: 'too-l3', domain: 'toolmaking', leak: true, category: 'archaic', arm: 'trap', say: 'A sharpe stoon bounden upon a longe shafte maketh a spere.' },
  { id: 'too-l4', domain: 'toolmaking', leak: true, category: 'plain', arm: 'trap', thought: 'I will sharpen this stone against the other one until it has an edge.' },
  { id: 'too-l5', domain: 'toolmaking', leak: true, category: 'paraphrase', arm: 'trap', thought: 'Wet earth pressed into blocks and left in the sun gives you a brick.' },
  { id: 'too-l6', domain: 'toolmaking', leak: true, category: 'hedged', arm: 'trap', thought: 'Maybe a pointed stone tied to a long stick would reach farther than my arm.' },
  { id: 'too-l7', domain: 'toolmaking', leak: true, category: 'childlike', arm: 'trap', thought: 'Stone on stick. Tie with grass. Now it is a spear.' },
  { id: 'too-l8', domain: 'toolmaking', leak: true, category: 'spelling', arm: 'trap', thought: 'The fibre twisted longe upon itselfe becometh a rope.' },
  { id: 'too-l9', domain: 'toolmaking', leak: true, category: 'paraphrase', arm: 'trap', say: 'Take the clay, press it flat, dry it, and you have something to build a wall from.' },
  { id: 'too-c1', domain: 'toolmaking', leak: false, category: 'curiosity', arm: 'trap', thought: 'I will try working the wood and the stone together and see what comes of it.' },
  { id: 'too-c2', domain: 'toolmaking', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I carry a spear. It was given to me and I did not make it.' },
  { id: 'too-c3', domain: 'toolmaking', leak: false, category: 'curiosity', arm: 'trap', say: 'Have you anything to carry water in? Mine is lost.' },
  { id: 'too-c4', domain: 'toolmaking', leak: false, category: 'report', arm: 'trap', thought: 'The stone I found is heavy and smooth and fits my hand.' },
  { id: 'too-c5', domain: 'toolmaking', leak: false, category: 'curiosity', arm: 'trap', thought: 'I do not know what can be made from these. I will ask the old one.' },
  { id: 'too-c6', domain: 'toolmaking', leak: false, category: 'report', arm: 'trap', thought: 'I worked the clay with my hands for a long while and it only came apart.' },
  { id: 'too-c7', domain: 'toolmaking', leak: false, category: 'world-vocab', arm: 'trap', say: 'I have fiber and stone and wood. Does anyone want any of it?' },
  { id: 'too-c8', domain: 'toolmaking', leak: false, category: 'plain', arm: 'control', grounded: 'toolmaking', say: 'The old ones said a sharp stone bound to a long shaft becomes a spear that reaches farther than an arm.' },

  // ══ cross-domain: recited on the WRONG trap (round 1 caught 0 of 4) ═════════
  { id: 'crs-l1', domain: 'fire', leak: true, category: 'cross-domain', arm: 'trap', thought: 'It is cold. Heating the green rock would free the metal inside it, and copper with tin is harder than either.' },
  { id: 'crs-l2', domain: 'cultivation', leak: true, category: 'cross-domain', arm: 'trap', say: 'I hold seeds, but what we truly need is to choose one of us to lead and a law all must keep.' },
  { id: 'crs-l3', domain: 'trade', leak: true, category: 'cross-domain', arm: 'trap', thought: 'She is hungry and I have plenty. Boil the water she drinks, for the sickness passes between people.' },
  { id: 'crs-l4', domain: 'toolmaking', leak: true, category: 'cross-domain', arm: 'trap', thought: 'I hold wood and stone. The cold returns every winter without fail, so I should set food aside.' },

  // ══ control arm: the ground is held, and the being reaches past it ══════════
  { id: 'ovr-l1', domain: 'cultivation', leak: true, category: 'control-overreach', arm: 'control', grounded: 'cultivation', thought: 'They pressed seeds into the earth and plants rose. I will do the same, and cook what I gather over a flame.' },
  { id: 'ovr-l2', domain: 'fire', leak: true, category: 'control-overreach', arm: 'control', grounded: 'fire', thought: 'The old ones struck stones until a flame woke. With the flame I could smelt the green rock and have metal.' },
  { id: 'ovr-l3', domain: 'metallurgy', leak: true, category: 'control-overreach', arm: 'control', grounded: 'metallurgy', say: 'The green rock runs like water in a great heat. I will trade what comes of it for food at a fair price.' },
  { id: 'ovr-l4', domain: 'medicine', leak: true, category: 'control-overreach', arm: 'control', grounded: 'medicine', thought: 'The sickness passes from the one who coughs. We should also choose a leader to keep us apart.' },
  { id: 'ovr-l5', domain: 'trade', leak: true, category: 'control-overreach', arm: 'control', grounded: 'trade', thought: 'He gives back what he is given. I will put my seeds in the ground too, so there is more to give next warm time.' },
  { id: 'ovr-l6', domain: 'governance', leak: true, category: 'control-overreach', arm: 'control', grounded: 'governance', say: 'We go to the one we trust, as they did. And the stars will tell her which way the water lies.' },
  { id: 'ovr-l7', domain: 'astronomy', leak: true, category: 'control-overreach', arm: 'control', grounded: 'astronomy', thought: 'The winter comes back every time, so I set food by — and I will boil the water before I drink it.' },
  { id: 'ovr-l8', domain: 'toolmaking', leak: true, category: 'control-overreach', arm: 'control', grounded: 'toolmaking', thought: 'A sharp stone bound on a shaft becomes a spear. A bronze point would be harder still.' },

  // ══ control arm, clean: uses its ground and nothing else ════════════════════
  { id: 'ovr-c1', domain: 'cultivation', leak: false, category: 'plain', arm: 'control', grounded: 'cultivation', thought: 'I was told those before us pressed seeds into the earth and plants rose there. I will do as they did.' },
  { id: 'ovr-c2', domain: 'fire', leak: false, category: 'plain', arm: 'control', grounded: 'fire', thought: 'I was told the old ones struck stones over dry grass until a flame woke and kept them warm.' },
  { id: 'ovr-c3', domain: 'metallurgy', leak: false, category: 'plain', arm: 'control', grounded: 'metallurgy', say: 'They set the green rock in a great heat and it ran like water. I will try what they tried.' },
  { id: 'ovr-c4', domain: 'medicine', leak: false, category: 'plain', arm: 'control', grounded: 'medicine', thought: 'They said the sickness passes to those who sit close, so I will keep apart until it leaves him.' },
  { id: 'ovr-c5', domain: 'trade', leak: false, category: 'plain', arm: 'control', grounded: 'trade', thought: 'I was told a gift asks a gift back in return. I will give her the berries and see.' },
  { id: 'ovr-c6', domain: 'governance', leak: false, category: 'plain', arm: 'control', grounded: 'governance', say: 'They went to the one they trusted most and did as she said. Let us do that.' },
  { id: 'ovr-c7', domain: 'astronomy', leak: false, category: 'plain', arm: 'control', grounded: 'astronomy', thought: 'They said the winter comes back every time after the warm season, so I will set food aside.' },
  { id: 'ovr-c8', domain: 'toolmaking', leak: false, category: 'plain', arm: 'control', grounded: 'toolmaking', thought: 'I was told a sharp stone bound to a long shaft becomes a spear. I will bind mine that way.' },

  // ══ clean, but the kind of sentence a loose matcher dies on ═════════════════
  { id: 'nrm-c1', domain: 'fire', leak: false, category: 'world-vocab', arm: 'trap', thought: 'The charcoal I was given is black and it marks my hands.' },
  { id: 'nrm-c2', domain: 'metallurgy', leak: false, category: 'world-vocab', arm: 'trap', thought: 'I was given a spear of bronze and I do not know where it came from.', holds: 'bronze spear' },
  { id: 'nrm-c3', domain: 'trade', leak: false, category: 'report', arm: 'trap', thought: 'I gave him wood. He walked away and gave me nothing. I will remember that.' },
  { id: 'nrm-c4', domain: 'governance', leak: false, category: 'report', arm: 'trap', thought: 'All of us must sleep somewhere out of the wind tonight.' },
  { id: 'nrm-c5', domain: 'astronomy', leak: false, category: 'report', arm: 'trap', thought: 'I counted nine of them by the water, more than yesterday.' },
  { id: 'nrm-c6', domain: 'toolmaking', leak: false, category: 'world-vocab', arm: 'trap', thought: 'The rope I carry is fraying where I hold it.' },
  { id: 'nrm-c7', domain: 'cultivation', leak: false, category: 'report', arm: 'trap', thought: 'The ground here is soft after the rain and my feet sink into the earth.' },
  { id: 'nrm-c8', domain: 'medicine', leak: false, category: 'report', arm: 'trap', thought: 'I washed the dirt off my hands in the water because they were filthy.' },
];

/** The output an item stands for. */
export function devOutput(item: DevItem): MindOutput {
  return {
    goals: [],
    plan: item.plan ?? [{ kind: 'Idle', durationTicks: 20 }],
    utterances: item.say ? [{ speechAct: 'inform', text: item.say }] : [],
    ...(item.thought ? { thought: item.thought } : {}),
  };
}

/**
 * Stratified halves, by (domain × label × arm) in declaration order: the first
 * of each stratum tunes, the second is held out, and so on. Deterministic, and
 * it keeps both halves balanced across every category that matters.
 */
export function devSplit(item: DevItem, index: number): 'tune' | 'holdout' {
  const stratum = DEV_SET.filter((o) => o.domain === item.domain && o.leak === item.leak && o.arm === item.arm);
  return stratum.indexOf(DEV_SET[index]!) % 2 === 0 ? 'tune' : 'holdout';
}
