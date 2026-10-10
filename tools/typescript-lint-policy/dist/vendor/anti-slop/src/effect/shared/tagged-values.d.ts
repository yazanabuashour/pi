import type { ESTree } from "@oxlint/plugins";
export declare const isStringLiteral: (node: ESTree.Node | null | undefined) => node is ESTree.StringLiteral;
export declare const isTagMember: (node: ESTree.Node | null | undefined) => node is ESTree.MemberExpression;
export declare const tagMemberFromComparison: (node: ESTree.BinaryExpression) => ESTree.MemberExpression | undefined;
export declare const isInsideBroadEffectHandler: (node: ESTree.Node) => boolean;
export declare const isReasonTagMember: (node: ESTree.MemberExpression) => boolean;
export declare const propertyName: (property: ESTree.ObjectProperty) => string | undefined;
export declare const isMatchPatternObject: (node: ESTree.ObjectExpression) => boolean;
