import { LoginPanel } from "@/components/LoginPanel";

/** 銀行担当者のログイン（すべての企業を見られる） */
export default function BankLoginPage() {
  return <LoginPanel portal="bank" />;
}
