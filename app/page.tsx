import type { Metadata } from "next";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = {
  title: "DASHFULL | Performance diária",
  description:
    "Painel público de performance, receita e retorno das campanhas DASHFULL.",
};

export default function Home() {
  return <DashboardClient />;
}
