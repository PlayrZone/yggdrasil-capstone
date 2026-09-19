import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

/**
 * WHAT A MIND CAN STILL DO TO A PLACE, ASKED OF THE TYPE CHECKER (W1-B4
 * verifier, the second fail).
 *
 * `mind-no-geometry.test.ts` matches NAMES: `place.x`, `Math.hypot`, `'north'`.
 * The verifier's hole is everything that never spells a name —
 *
 *     const u = Object.values(a), v = Object.values(b);
 *     return Math.sqrt((u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2);
 *
 * — a full Euclidean distance that passes every guard, because not one token in
 * it is a coordinate or a compass word. `Object.keys/entries`, `{...p}`,
 * `structuredClone`, `Reflect.ownKeys`, `for…in` and `const K='x'; q[K]` are the
 * same leak wearing other clothes.
 *
 * So this asks the compiler instead of the tokens: it builds a `ts.Program` over
 * the mind and reports every expression WHOSE TYPE IS `PlaceRef` flowing into
 * something that could open it. A name can be avoided; a type cannot.
 *
 * WHAT IT DOES NOT DO. It does not police arithmetic on numbers — that is the
 * name guard's job and `SpaceOps.distance` legitimately returns one. It polices
 * the HANDLE: the moment a place stops being passed around whole, something is
 * reading a world's private data, whatever it calls the variable.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SPACE_MODULE = path.join(SRC, 'contract', 'space.ts');

/** One thing a mind did to a place that it may not do. */
export interface PlaceLeak {
  /** `consciousness/prompt.ts` — repo-relative, `/` separated. */
  file: string;
  line: number;
  /** The enclosing function, or `<module>`. What an allow-list entry names. */
  fn: string;
  /** Which of the routes below. What a negative control asserts. */
  route: PlaceRoute;
  /** The offending source text, trimmed — for a failure message that diagnoses. */
  text: string;
}

export type PlaceRoute =
  | 'member access'
  | 'element access'
  | 'reflection'
  | 'spread'
  | 'destructuring'
  | 'for…in'
  | 'in'
  | 'template'
  | 'arithmetic'
  | 'comparison'
  | 'cast away'
  | 'mint';

/**
 * EVERY FUNCTION THAT OPENS A VALUE RATHER THAN PASSING IT ON. `Object.assign`
 * and `Reflect.*` are here for the verifier's list; `JSON.stringify`,
 * `structuredClone` and `String` are here because a place's runtime value is the
 * world's own datum, so writing one out and reading the result back is the same
 * leak with a round trip in the middle.
 */
const OPENERS = new Set([
  'Object.keys',
  'Object.values',
  'Object.entries',
  'Object.assign',
  'Object.fromEntries',
  'Object.getOwnPropertyNames',
  'Object.getOwnPropertySymbols',
  'Object.getOwnPropertyDescriptor',
  'Object.getOwnPropertyDescriptors',
  'Object.getPrototypeOf',
  'Object.setPrototypeOf',
  'Object.freeze',
  'Object.seal',
  'Object.create',
  'JSON.stringify',
  'structuredClone',
  'String',
]);

const ARITHMETIC = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

const EQUALITY = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

export function compilerOptionsFor(tsconfig: string): ts.CompilerOptions {
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, ' '));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfig));
  // Nothing is emitted, and the control fixtures live under `test/`; `rootDir`
  // would otherwise report every one of them as outside the source tree.
  return { ...parsed.options, rootDir: undefined, noEmit: true, declaration: false, declarationMap: false, sourceMap: false };
}

/** Every place-handling leak in `files`, in source order. */
export function placeLeaksIn(program: ts.Program, files: readonly string[]): PlaceLeak[] {
  const checker = program.getTypeChecker();

  /** Is this type `PlaceRef` — the one declared in `contract/space.ts`? */
  const isPlaceRef = (type: ts.Type): boolean => {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol?.getName() !== 'PlaceRef') return false;
    return (symbol.getDeclarations() ?? []).some(
      (d) => path.resolve(d.getSourceFile().fileName).toLowerCase() === SPACE_MODULE.toLowerCase(),
    );
  };

  /**
   * …or a union with one in it, which is the shape a place is actually held in:
   * `PlaceRef | undefined`. Arrays are deliberately NOT descended into —
   * `[...tragedyPlaces]` copies handles and opens nothing.
   */
  const holdsPlace = (type: ts.Type): boolean =>
    type.isUnionOrIntersection() ? type.types.some(isPlaceRef) : isPlaceRef(type);

  /**
   * …and the stricter question the CAST routes ask: is this value a place and
   * nothing else? A cast off a wide union that happens to contain `PlaceRef`
   * among a dozen other things — `Object.entries(thinkInput)`'s value type — is
   * not a place being prised open, and flagging it would make the guard cry
   * wolf at the serializer's ordinary walk. `PlaceRef | undefined` is still a
   * place: that is the shape one is actually held in.
   */
  const isOnlyPlace = (type: ts.Type): boolean => {
    const parts = type.isUnionOrIntersection() ? type.types : [type];
    const real = parts.filter((t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) === 0);
    return real.length > 0 && real.every(isPlaceRef);
  };

  const typeOf = (node: ts.Node): ts.Type => checker.getTypeAtLocation(node);
  const isPlace = (node: ts.Node): boolean => holdsPlace(typeOf(node));

  const leaks: PlaceLeak[] = [];
  const enclosing = (node: ts.Node): string => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      if (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at) || ts.isFunctionExpression(at)) {
        return at.name?.getText() ?? '<anonymous>';
      }
      if (ts.isArrowFunction(at) && ts.isVariableDeclaration(at.parent)) return at.parent.name.getText();
      if (ts.isVariableDeclaration(at) && at.initializer && ts.isArrowFunction(at.initializer)) return at.name.getText();
    }
    return '<module>';
  };

  for (const fileName of files) {
    const source = program.getSourceFile(fileName);
    if (!source) throw new Error(`the guard could not compile ${fileName}`);
    const relative = path.relative(SRC, fileName).split(path.sep).join('/');
    const report = (node: ts.Node, route: PlaceRoute): void => {
      leaks.push({
        file: relative,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        fn: enclosing(node),
        route,
        text: node.getText().replace(/\s+/g, ' ').slice(0, 90),
      });
    };

    const visit = (node: ts.Node): void => {
      // `p.x`, `p.toString()`, `p?.anything` — a place has no member, so reaching
      // for one at all is reaching past the handle.
      if (ts.isPropertyAccessExpression(node) && isPlace(node.expression)) report(node, 'member access');
      // `p['x']`, `p[K]`, `p[k]` — the const-key route the verifier found.
      if (ts.isElementAccessExpression(node) && isPlace(node.expression)) report(node, 'element access');
      // `Object.values(p)`, `Reflect.ownKeys(p)`, `structuredClone(p)`, `String(p)`.
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText().replace(/\s+/g, '');
        if (OPENERS.has(callee) || callee.startsWith('Reflect.')) {
          for (const argument of node.arguments) if (isPlace(argument)) report(node, 'reflection');
        }
      }
      // `{ ...p }` and `[...p]`.
      if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && isPlace(node.expression)) {
        report(node, 'spread');
      }
      // `const { x } = p` / `({ x }: PlaceRef) => …`.
      if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name) && node.initializer && isPlace(node.initializer)) {
        report(node, 'destructuring');
      }
      if (ts.isParameter(node) && !ts.isIdentifier(node.name) && isPlace(node)) report(node, 'destructuring');
      if (ts.isForInStatement(node) && isPlace(node.expression)) report(node, 'for…in');
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        if (op === ts.SyntaxKind.InKeyword && isPlace(node.right)) report(node, 'in');
        else if (ARITHMETIC.has(op) && (isPlace(node.left) || isPlace(node.right))) report(node, 'arithmetic');
        else if (EQUALITY.has(op) && (isPlace(node.left) || isPlace(node.right)) && !nothingLiteral(node.left) && !nothingLiteral(node.right)) {
          // `place === undefined` is the one comparison that is not a comparison
          // of places: it asks whether there is one at all, which every caller of
          // `placeOf` has to. `space.equal` is the only other answer.
          report(node, 'comparison');
        }
      }
      // `` `${p}` `` — the place's own `toString`, spliced into a prompt.
      if (ts.isTemplateSpan(node) && isPlace(node.expression)) report(node, 'template');
      // `p as any`, `p as unknown`, `p as {x: number}` — and the reverse, which
      // is a mind MINTING a place the world never gave it.
      if (ts.isAsExpression(node) || node.kind === ts.SyntaxKind.TypeAssertionExpression) {
        const cast = node as ts.AsExpression | ts.TypeAssertion;
        const from = isOnlyPlace(typeOf(cast.expression));
        const to = isOnlyPlace(checker.getTypeFromTypeNode(cast.type));
        if (from && !to) report(node, 'cast away');
        if (!from && to) report(node, 'mint');
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  return leaks;
}

/** `undefined` / `null`, the two things a missing place is compared against. */
function nothingLiteral(node: ts.Node): boolean {
  const text = node.getText();
  return text === 'undefined' || text === 'null';
}

/** `file:fn:route`, which is what an allow-list entry and a control both name. */
export function leakKey(leak: PlaceLeak): string {
  return `${leak.file}:${leak.fn}:${leak.route}`;
}
