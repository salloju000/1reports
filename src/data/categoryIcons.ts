import type { ElementType } from "react";
import {
  Wallet,
  TrendingUp,
  Boxes,
  ShoppingCart,
  Factory,
  Users,
  Building2,
  ShieldCheck,
} from "lucide-react";
export const categoryIcons: Record<string, ElementType> = {
  finance: Wallet,
  sales: TrendingUp,
  inventory: Boxes,
  purchasing: ShoppingCart,
  production: Factory,
  receivable: Users,
  payable: Building2,
  administration: ShieldCheck,
};
