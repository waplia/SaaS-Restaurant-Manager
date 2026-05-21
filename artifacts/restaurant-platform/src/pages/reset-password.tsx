import { useEffect } from "react";
import { useLocation } from "wouter";

// The password-reset flow moved from an emailed link to an OTP entered on
// the same screen as the email step (see forgot-password.tsx). Anyone who
// lands here from an old email link gets redirected to the new flow.
export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/forgot-password"); }, [navigate]);
  return null;
}
