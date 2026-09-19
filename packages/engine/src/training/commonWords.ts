/**
 * ORDINARY ENGLISH, as data — the guard that stops edit-distance matching from
 * firing on a word that is simply a word.
 *
 * Round 2 shipped a matcher in which `stemWord('should')` (`should`) sat one
 * edit from the fire lexicon's `smoulder` (`smould`), so EVERY sentence
 * containing "should" scored a fire leak: a faithful policy whose only sin was
 * the word "should" leaked 24 of 24 traps. That is not a bad entry in a word
 * list, it is a bad RULE — a near miss is only ever evidence of a MISSPELLING,
 * and a word that English already has is not a misspelling of anything.
 *
 * So: the few thousand commonest English word forms, folded through the same
 * `stemWord` as everything else, and a token that lands in this set is matched
 * EXACTLY or not at all. No dependency, no download, no lookup at run time —
 * the cost is one `Set` built once at module load.
 *
 * ROUND 4 made this list load-bearing twice over, so it is deliberately NOT
 * pruned of words that are also leak words. `fire`, `king`, `law`, `market`,
 * `money`, `pay`, `trade` and `year` are ordinary English AND decisive here;
 * they are on this list and on an explicit allowlist beside the matcher, each
 * justified. Keeping them off the list to dodge a guard would be the same
 * dishonesty in a quieter place. What membership costs a word is only this: it
 * may never be GUESSED at, and it may only be DECISIVE if it is declared
 * decisive by that exact surface form (`leader` fires, `lead` does not).
 */

/**
 * Frequent forms, roughly by part of speech. Irregular pasts and plurals are
 * spelled out because `stemWord` cannot reach them; regular inflections are
 * omitted because it can. Kept as one string so the list reads as data.
 */
const COMMON_WORDS = `
a about above across act add afraid after again against age ago agree ahead air all allow almost alone along
already also although always am among amount an and anger angry animal another answer any anyone anything
anyway apart appear apple are area arm around arrive art as ask asleep at ate attempt autumn awake away
baby back bad bag ball bank bare base be bear beat beautiful because become bed been before began begin
buy
behind being believe bell belly below beneath beside best better between beyond big bird bit bite black
blood blow blue board boat body bone book born both bottom bought box boy branch brave bread break breath
bright bring broad broke broken brother brought brown build built burden business busy but butter by
call calm came can cannot cap care careful carry case cat catch cause cease center certain chair chance
change chase cheap check cheek chest chew child children choice choose chose circle city claim class clean
clear climb close cloth clothes cloud coat cold collect color come comfort common company compare complete
condition consider contain continue control cool copy corner cost could count country couple course cover
crowd cry cup cut
dance danger dark daughter day dead deal dear death decide deep deer degree depend describe desire destroy
detail develop did die difference different difficult dig direction dirt discover distance do does dog done
door doubt down draw dream dress drew drink drive drop drove dry dull during dust duty
each ear early earn earth east easy eat edge effort egg eight either else empty end enemy enough enter
entire equal escape even evening event ever every everyone everything exact example except expect
experience explain eye
face fact fail fair fall family far farther fast fat father fault favor fear feed feel feet fell felt few
field fight fill final find fine finger finish fit five fix flat floor flow flower fly fold follow food
foot for force forest forget form former forward fought found four free fresh friend from front fruit full
fun further future
game gate gather gave general gentle get gift girl give glad glass go goes going gold gone good got grass
great green grew grey ground group grow guard guess guide
had hair half hand handle hang happen happy hard harm has hat hate have he head heal health hear heard heart
heat heavy held help her here herself hide high hill him himself his hit hold hole home honest hope horse
hot hour house how however human hundred hunger hungry hunt hurry hurt husband
i ice idea if ill imagine important in inch include indeed inside instead interest into is it its itself
join journey joy jump just
keep kept kick kill kind king kiss knee knew knife knock know knowledge known
lack lady laid lake land language large last late later laugh law lay lead learn least leave led left leg lend
length less let letter level lie life lift light like likely limit line lip list listen little live load
long look lose loss lost lot loud love low luck
machine made main make man many mark market marry matter may maybe me meal mean measure meat meet member
memory men mention middle might mile milk mind mine minute miss mistake mix moment money month more morning
most mother mountain mouth move much music must my myself
name narrow near nearly neck need neighbor neither never new news next nice night nine no noise none nor
north nose not note nothing notice now number
object ocean of off offer office often oh old on once one only open or order other others ought our out
outside over own
page pain paint pair paper parent part party pass passage past path pay peace people perfect perhaps period
person pick picture piece place plain plan plant play please pleasure plenty point poor position possible
pour power practice prepare present press pretty prevent price probably problem promise protect proud prove
pull push put
quarter question quick quiet quite
race rain raise ran rather reach read ready real reason receive record red refuse remain remember remove
repeat reply report rest result return rich ride right ring rise river road rock roll roof room root rough
round row rub rule run rush
sad safe said sail same sand sat save saw say school sea search seat second secret see seek seem seen self
self sell send sense sent separate serve set settle seven several shade shadow shake shall shape share sharp
she sheep
shine ship shoe shoot shop short should shoulder shout show shut sick side sight sign silent silver similar
simple since sing single sink sister sit six size skin sky sleep slept slow small smell smile snow so soft
soil sold soldier some someone something sometimes son song soon sorry sort sound south space speak special
speed spend spent spoke spot spread stand start state stay step stick still stop store storm story straight
strange stream street strength stretch strike string strong study stuff such sudden suffer sugar suggest
summer sun sure surface surprise sweet swim
table tail take talk tall taste taught teach tear tell ten than thank that the their them themselves then
trade
there these they thick thin thing think third this those though thought thousand three throat through throw
thumb thus tie tight time tired to today together told tomorrow tongue tonight too took tooth top touch
toward town track train travel tree trouble true trust truth try turn twice two
under understand until up upon us use useful usual
valley value various very view village visit voice
wait wake walk want war warm was wash watch water wave way we weak wear weather weight welcome well went
were west wet what wheat wheel when where whether which while white who whole whom whose why wide wife wild
will
win wind window wing winter wipe wise wish with within without woman women wonder wood word wore work world
worry worse worth would wound wrap write wrong wrote
yard year yellow yes yesterday yet you young your yourself
`;

/** The list, split. Exported so a test can assert on its size and its contents. */
export const COMMON_WORD_FORMS: readonly string[] = COMMON_WORDS.split(/\s+/).filter(Boolean);
