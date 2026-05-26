/**
 * Tiny stateful calculator hook backing the POS calculator overlay.
 * Supports `+ − × ÷ %`, parens, memory, and decimal entry. Tokenises
 * the expression and evaluates with a shunting-yard pass — no `eval`,
 * no surprises.
 */
import { useCallback, useState } from "react";

const OPERATORS = new Set(["+", "-", "*", "/", "%"]);

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " ") { i++; continue; }
    if (ch === "(" || ch === ")") { tokens.push(ch); i++; continue; }
    if (OPERATORS.has(ch)) {
      if (
        (ch === "-" || ch === "+") &&
        (tokens.length === 0 ||
          tokens[tokens.length - 1] === "(" ||
          OPERATORS.has(tokens[tokens.length - 1]))
      ) {
        // unary +/- — fold into the next number
        let j = i + 1;
        let num = ch === "-" ? "-" : "";
        while (j < input.length && /[0-9.]/.test(input[j])) { num += input[j]; j++; }
        if (num === "-" || num === "") throw new Error("Bad expression");
        tokens.push(num);
        i = j;
        continue;
      }
      tokens.push(ch); i++; continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let num = "";
      while (j < input.length && /[0-9.]/.test(input[j])) { num += input[j]; j++; }
      tokens.push(num);
      i = j;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

function precedence(op: string): number {
  if (op === "+" || op === "-") return 1;
  if (op === "*" || op === "/" || op === "%") return 2;
  return 0;
}

function toRpn(tokens: string[]): string[] {
  const output: string[] = [];
  const stack: string[] = [];
  for (const tok of tokens) {
    if (!isNaN(Number(tok))) { output.push(tok); continue; }
    if (OPERATORS.has(tok)) {
      while (stack.length && OPERATORS.has(stack[stack.length - 1]) &&
             precedence(stack[stack.length - 1]) >= precedence(tok)) {
        output.push(stack.pop() as string);
      }
      stack.push(tok); continue;
    }
    if (tok === "(") { stack.push(tok); continue; }
    if (tok === ")") {
      while (stack.length && stack[stack.length - 1] !== "(") output.push(stack.pop() as string);
      if (!stack.length) throw new Error("Mismatched parens");
      stack.pop();
      continue;
    }
  }
  while (stack.length) {
    const t = stack.pop() as string;
    if (t === "(" || t === ")") throw new Error("Mismatched parens");
    output.push(t);
  }
  return output;
}

function evalRpn(rpn: string[]): number {
  const stack: number[] = [];
  for (const tok of rpn) {
    if (!isNaN(Number(tok))) { stack.push(Number(tok)); continue; }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error("Bad expression");
    switch (tok) {
      case "+": stack.push(a + b); break;
      case "-": stack.push(a - b); break;
      case "*": stack.push(a * b); break;
      case "/": if (b === 0) throw new Error("Divide by zero"); stack.push(a / b); break;
      case "%": stack.push(a * (b / 100)); break;
    }
  }
  if (stack.length !== 1) throw new Error("Bad expression");
  return stack[0];
}

export function evaluateExpression(expr: string): number {
  return evalRpn(toRpn(tokenize(expr)));
}

export function useCalculator() {
  const [expr, setExpr] = useState("");
  const [memory, setMemory] = useState(0);
  const [history, setHistory] = useState<Array<{ expr: string; value: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  const append = useCallback((s: string) => {
    setError(null);
    setExpr(prev => prev + s);
  }, []);

  const clear = useCallback(() => { setExpr(""); setError(null); }, []);
  const backspace = useCallback(() => { setExpr(prev => prev.slice(0, -1)); setError(null); }, []);

  const equals = useCallback((): number | null => {
    if (!expr.trim()) return null;
    try {
      const v = evaluateExpression(expr);
      const rounded = Math.round(v * 100) / 100;
      setHistory(prev => [{ expr, value: rounded }, ...prev].slice(0, 20));
      setExpr(String(rounded));
      return rounded;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [expr]);

  const memoryAdd = useCallback(() => {
    if (!expr.trim()) return;
    try { setMemory(m => m + evaluateExpression(expr)); } catch { /* ignore */ }
  }, [expr]);
  const memorySub = useCallback(() => {
    if (!expr.trim()) return;
    try { setMemory(m => m - evaluateExpression(expr)); } catch { /* ignore */ }
  }, [expr]);
  const memoryRecall = useCallback(() => { setExpr(String(memory)); setError(null); }, [memory]);
  const memoryClear = useCallback(() => setMemory(0), []);

  return {
    expr, memory, history, error,
    append, clear, backspace, equals,
    memoryAdd, memorySub, memoryRecall, memoryClear,
  };
}
