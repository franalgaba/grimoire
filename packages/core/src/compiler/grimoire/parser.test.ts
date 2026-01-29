/**
 * Parser tests
 */

import { describe, expect, test } from "bun:test";
import type {
  AdvisoryExpr,
  ArrayLiteralNode,
  AssetsSection,
  AssignmentNode,
  BinaryExprNode,
  CallExprNode,
  ForNode,
  IfNode,
  ParamsSection,
  PercentageExpr,
  StateSection,
  UnaryExprNode,
  VenueRefExpr,
  VenuesSection,
  VersionSection,
} from "./ast.js";
import { parse } from "./parser.js";

describe("Parser", () => {
  describe("error handling", () => {
    test("throws on missing spell name", () => {
      expect(() => parse("spell\n  version: 1")).toThrow();
    });

    test("throws on missing spell body", () => {
      expect(() => parse("spell Test")).toThrow();
    });

    test("throws on invalid token in expression", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = @
`;
      expect(() => parse(source)).toThrow();
    });
  });

  describe("spell declaration", () => {
    test("parses minimal spell", () => {
      const source = `spell TestSpell

  version: "1.0.0"
`;
      const ast = parse(source);
      expect(ast.kind).toBe("spell");
      expect(ast.name).toBe("TestSpell");
    });

    test("parses spell with version and description", () => {
      const source = `spell MySpell

  version: "2.0.0"
  description: "A test spell"
`;
      const ast = parse(source);
      expect(ast.name).toBe("MySpell");

      const versionSection = ast.sections.find((s): s is VersionSection => s.kind === "version");
      expect(versionSection).toBeDefined();
      expect(versionSection?.value).toBe("2.0.0");
    });
  });

  describe("sections", () => {
    test("parses assets section with array", () => {
      const source = `spell Test

  version: "1.0.0"
  assets: [USDC, USDT, DAI]
`;
      const ast = parse(source);
      const assetsSection = ast.sections.find((s): s is AssetsSection => s.kind === "assets");
      expect(assetsSection).toBeDefined();
      expect(assetsSection?.items.length).toBe(3);
      expect(assetsSection?.items.map((item) => item.symbol)).toEqual(["USDC", "USDT", "DAI"]);
    });

    test("parses params section", () => {
      const source = `spell Test

  version: "1.0.0"
  params:
    amount: 100
    threshold: 0.5
`;
      const ast = parse(source);
      const paramsSection = ast.sections.find((s): s is ParamsSection => s.kind === "params");
      expect(paramsSection).toBeDefined();
      expect(paramsSection?.items.length).toBe(2);
    });

    test("parses limits section with percentages", () => {
      const source = `spell Test

  version: "1.0.0"
  limits:
    max_allocation: 50%
    min_threshold: 0.5%
`;
      const ast = parse(source);
      const limitsSection = ast.sections.find((s) => s.kind === "limits");
      expect(limitsSection).toBeDefined();
    });

    test("parses venues section", () => {
      const source = `spell Test

  version: "1.0.0"
  venues:
    lending: [@aave_v3, @morpho]
    swap: @uniswap_v3
`;
      const ast = parse(source);
      const venuesSection = ast.sections.find((s): s is VenuesSection => s.kind === "venues");
      expect(venuesSection).toBeDefined();
      expect(venuesSection?.groups.length).toBe(2);
    });
  });

  describe("additional sections", () => {
    test("parses skills section", () => {
      const source = `spell Test

  version: "1.0.0"
  skills:

  on manual:
    pass
`;
      const ast = parse(source);
      const skillsSection = ast.sections.find((s) => s.kind === "skills");
      expect(skillsSection).toBeDefined();
    });

    test("parses advisors section", () => {
      const source = `spell Test

  version: "1.0.0"
  advisors:

  on manual:
    pass
`;
      const ast = parse(source);
      const advisorsSection = ast.sections.find((s) => s.kind === "advisors");
      expect(advisorsSection).toBeDefined();
    });

    test("parses guards section", () => {
      const source = `spell Test

  version: "1.0.0"
  guards:

  on manual:
    pass
`;
      const ast = parse(source);
      const guardsSection = ast.sections.find((s) => s.kind === "guards");
      expect(guardsSection).toBeDefined();
    });

    test("parses state with both persistent and ephemeral", () => {
      const source = `spell Test

  version: "1.0.0"
  state:
    persistent:
      counter: 0
    ephemeral:
      temp: 0

  on manual:
    pass
`;
      const ast = parse(source);
      const stateSection = ast.sections.find((s): s is StateSection => s.kind === "state");
      expect(stateSection).toBeDefined();
      expect(stateSection?.persistent.length).toBe(1);
      expect(stateSection?.ephemeral.length).toBe(1);
    });
  });

  describe("triggers", () => {
    test("parses manual trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    pass
`;
      const ast = parse(source);
      expect(ast.triggers.length).toBe(1);
      expect(ast.triggers[0]?.trigger.kind).toBe("manual");
    });

    test("parses hourly trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on hourly:
    pass
`;
      const ast = parse(source);
      expect(ast.triggers[0]?.trigger.kind).toBe("hourly");
    });

    test("parses daily trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on daily:
    pass
`;
      const ast = parse(source);
      expect(ast.triggers[0]?.trigger.kind).toBe("daily");
    });
  });

  describe("statements", () => {
    test("parses assignment", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 42
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.kind).toBe("assignment");
      expect(stmt.target).toBe("x");
    });

    test("parses if statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if x > 10:
      pass
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as IfNode;
      expect(stmt.kind).toBe("if");
      expect(stmt.thenBody.length).toBe(1);
    });

    test("parses if-else statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if x > 10:
      pass
    else:
      pass
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as IfNode;
      expect(stmt.kind).toBe("if");
      expect(stmt.elseBody.length).toBe(1);
    });

    test("parses if-elif-else statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if x > 10:
      pass
    elif x > 5:
      pass
    else:
      pass
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as IfNode;
      expect(stmt.kind).toBe("if");
      expect(stmt.elifs.length).toBe(1);
      expect(stmt.elseBody.length).toBe(1);
    });

    test("parses for loop", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    for item in items:
      pass
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as ForNode;
      expect(stmt.kind).toBe("for");
      expect(stmt.variable).toBe("item");
    });

    test("parses atomic block", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    atomic:
      pass
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0];
      expect(stmt.kind).toBe("atomic");
    });

    test("parses emit statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    emit result(value=42)
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0];
      expect(stmt.kind).toBe("emit");
    });

    test("parses halt statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    halt "error occurred"
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0];
      expect(stmt.kind).toBe("halt");
    });

    test("parses wait statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    wait 3600
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0];
      expect(stmt.kind).toBe("wait");
    });
  });

  describe("expressions", () => {
    test("parses binary expressions with correct precedence", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = a + b * c
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("binary");
      // a + (b * c) - multiplication has higher precedence
      if (stmt.value.kind !== "binary") {
        throw new Error("Expected binary expression");
      }
      const binExpr = stmt.value as BinaryExprNode;
      expect(binExpr.op).toBe("+");
      if (binExpr.right.kind !== "binary") {
        throw new Error("Expected binary expression");
      }
      const rightExpr = binExpr.right as BinaryExprNode;
      expect(rightExpr.op).toBe("*");
    });

    test("parses comparison expressions", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = a > b
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("binary");
      if (stmt.value.kind !== "binary") {
        throw new Error("Expected binary expression");
      }
      expect((stmt.value as BinaryExprNode).op).toBe(">");
    });

    test("parses logical expressions", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = a and b or c
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      // (a and b) or c - and has higher precedence
      if (stmt.value.kind !== "binary") {
        throw new Error("Expected binary expression");
      }
      expect((stmt.value as BinaryExprNode).op).toBe("or");
    });

    test("parses unary not", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = not y
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("unary");
      if (stmt.value.kind !== "unary") {
        throw new Error("Expected unary expression");
      }
      expect((stmt.value as UnaryExprNode).op).toBe("not");
    });

    test("parses property access", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = obj.prop
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("property_access");
    });

    test("parses array access", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = arr[0]
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("array_access");
    });

    test("parses function call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = max(a, b)
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("call");
      if (stmt.value.kind !== "call") {
        throw new Error("Expected call expression");
      }
      expect((stmt.value as CallExprNode).args.length).toBe(2);
    });

    test("parses method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = obj.method(arg)
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("call");
    });

    test("parses array literal", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = [1, 2, 3]
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("array_literal");
      if (stmt.value.kind !== "array_literal") {
        throw new Error("Expected array literal");
      }
      expect((stmt.value as ArrayLiteralNode).elements.length).toBe(3);
    });

    test("parses venue reference expression", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = @aave_v3
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("venue_ref_expr");
      if (stmt.value.kind !== "venue_ref_expr") {
        throw new Error("Expected venue ref expression");
      }
      expect((stmt.value as VenueRefExpr).name).toBe("aave_v3");
    });

    test("parses percentage expression", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 50%
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as AssignmentNode;
      expect(stmt.value.kind).toBe("percentage");
      if (stmt.value.kind !== "percentage") {
        throw new Error("Expected percentage expression");
      }
      expect((stmt.value as PercentageExpr).value).toBe(0.5);
    });

    test("parses advisory expression in if condition", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if **is this safe**:
      pass
`;
      const ast = parse(source);
      const stmt = ast.triggers[0]?.body[0] as IfNode;
      expect(stmt.condition.kind).toBe("advisory_expr");
      if (stmt.condition.kind !== "advisory_expr") {
        throw new Error("Expected advisory expression");
      }
      expect((stmt.condition as AdvisoryExpr).prompt).toBe("is this safe");
    });
  });

  describe("complex spells", () => {
    test("parses full lending optimizer spell", () => {
      const source = `spell LendingYieldOptimizer

  version: "1.0.0"
  assets: [USDC, USDT, DAI]

  limits:
    max_allocation_per_venue: 50%
    min_rebalance_threshold: 0.5%

  venues:
    lending: [@aave_v3, @morpho]
    swap: @uniswap_v3

  on hourly:
    for asset in assets:
      rates = lending.get_supply_rates(asset)
      best_venue = max(rates, key=rate)
      if rate_diff > limits.min_rebalance_threshold:
        atomic:
          current_venue.withdraw(asset, balance)
          best_venue.deposit(asset, balance)
`;
      const ast = parse(source);
      expect(ast.name).toBe("LendingYieldOptimizer");
      expect(ast.sections.length).toBeGreaterThan(0);
      expect(ast.triggers.length).toBe(1);
      expect(ast.triggers[0]?.trigger.kind).toBe("hourly");

      // Check for loop in body
      const forLoop = ast.triggers[0]?.body.find((s) => s.kind === "for");
      expect(forLoop).toBeDefined();
    });
  });
});
