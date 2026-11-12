"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

async function call(path, { method = "POST", body } = {}) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const f = (formData, name) => String(formData.get(name) ?? "");
const back = (page, result, saved, fallback) => {
  if (!result.ok) redirect(`${page}${page.includes("?") ? "&" : "?"}error=${encodeURIComponent(result.data?.error || fallback)}`);
  redirect(`${page}${page.includes("?") ? "&" : "?"}saved=${saved}`);
};

export async function saveCompany(formData) {
  const result = await call("/v1/billing/settings/company", {
    method: "PUT",
    body: {
      legalName: f(formData, "legalName"),
      tradingName: f(formData, "tradingName"),
      companyRegNo: f(formData, "companyRegNo"),
      physicalAddress: f(formData, "physicalAddress"),
      postalAddress: f(formData, "postalAddress"),
      email: f(formData, "email"),
      phone: f(formData, "phone"),
      website: f(formData, "website"),
      bbbeeLevel: f(formData, "bbbeeLevel"),
      csdNumber: f(formData, "csdNumber"),
      defaultTermsDays: f(formData, "defaultTermsDays"),
      defaultNotes: f(formData, "defaultNotes"),
      defaultTermsText: f(formData, "defaultTermsText"),
      priceMode: f(formData, "priceMode"),
      defaultTemplate: f(formData, "defaultTemplate"),
      primaryColour: f(formData, "primaryColour"),
      secondaryColour: f(formData, "secondaryColour"),
      linkExpiryDays: f(formData, "linkExpiryDays"),
      attachPdf: formData.get("attachPdf") === "on",
      bank: {
        bankName: f(formData, "bankName"),
        accountName: f(formData, "accountName"),
        accountNumber: f(formData, "accountNumber"),
        branchCode: f(formData, "branchCode"),
        accountType: f(formData, "accountType"),
        swift: f(formData, "swift"),
      },
    },
  });
  back("/billing/settings/company", result, "company", "The company details were not saved.");
}

export async function addVatRecord(formData) {
  const result = await call("/v1/billing/settings/vat", {
    body: { vatRegistered: f(formData, "vatRegistered"), vatNumber: f(formData, "vatNumber"), effectiveFrom: f(formData, "effectiveFrom") },
  });
  back("/billing/settings/company", result, "vat", "The VAT change was not saved.");
}

export async function removeVatRecord(formData) {
  const id = f(formData, "id").replace(/\D/g, "");
  const result = await call(`/v1/billing/settings/vat/${id}`, { method: "DELETE" });
  back("/billing/settings/company", result, "vatRemoved", "The VAT change was not removed.");
}

export async function saveSequence(formData) {
  const result = await call("/v1/billing/settings/numbering", {
    method: "PUT",
    body: {
      kind: f(formData, "kind"),
      prefix: f(formData, "prefix"),
      padding: f(formData, "padding"),
      nextNumber: f(formData, "nextNumber"),
      includeYear: formData.get("includeYear") === "on",
      resetYearly: formData.get("resetYearly") === "on",
    },
  });
  back("/billing/settings/numbering", result, "numbering", "The numbering was not saved.");
}

export async function saveTaxRate(formData) {
  const id = f(formData, "id").replace(/\D/g, "");
  const result = await call(`/v1/billing/settings/tax-rates/${id}`, { method: "PUT", body: { accountCode: f(formData, "accountCode") } });
  back("/billing/settings/tax-rates", result, "rate", "The account code was not saved.");
}

export async function saveItem(formData) {
  const id = f(formData, "id").replace(/\D/g, "");
  const result = await call(id ? `/v1/billing/items/${id}` : "/v1/billing/items", {
    method: id ? "PUT" : "POST",
    body: {
      name: f(formData, "name"),
      description: f(formData, "description"),
      sku: f(formData, "sku"),
      type: f(formData, "type"),
      unit: f(formData, "unit"),
      unitPrice: f(formData, "unitPrice") || "0",
      taxType: f(formData, "taxType"),
      accountCode: f(formData, "accountCode"),
      cost: f(formData, "cost"),
      active: formData.get("active") === "on",
    },
  });
  if (!result.ok) redirect(`/billing/items/${id || "new"}?error=${encodeURIComponent(result.data?.error || "The item was not saved.")}`);
  redirect(`/billing/items?saved=${id ? "itemUpdated" : "itemCreated"}`);
}

export async function recordPayment(formData) {
  const customerId = f(formData, "customerId").replace(/\D/g, "");
  const allocations = [];
  for (const [name, value] of formData.entries()) {
    const match = name.match(/^alloc_(\d+)$/);
    if (match && String(value).trim()) allocations.push({ documentId: Number(match[1]), amount: String(value) });
  }
  const result = await call("/v1/billing/payments", {
    body: {
      customerId: Number(customerId),
      date: f(formData, "date"),
      amount: f(formData, "amount"),
      method: f(formData, "method"),
      reference: f(formData, "reference"),
      notes: f(formData, "notes"),
      allocations,
    },
  });
  const back = f(formData, "back").replace(/[^\d]/g, "");
  if (!result.ok) {
    redirect(`/billing/payments/new?customer=${customerId}${back ? `&invoice=${back}` : ""}&error=${encodeURIComponent(result.data?.error || "The payment was not recorded.")}`);
  }
  if (back) redirect(`/billing/documents/${back}?saved=payment`);
  redirect(`/billing/payments?saved=${result.data.creditCents ? "paymentCredit" : "payment"}`);
}

export async function createCustomer(formData) {
  const result = await call("/v1/billing/customers", {
    body: {
      name: f(formData, "name"),
      billingEmail: f(formData, "billingEmail"),
      billingContact: f(formData, "billingContact"),
      billingAddress: f(formData, "billingAddress"),
      vatStatus: f(formData, "vatStatus"),
      vatNumber: f(formData, "vatNumber"),
      paymentTermsDays: f(formData, "paymentTermsDays"),
    },
  });
  if (!result.ok) redirect(`/billing/customers/new?error=${encodeURIComponent(result.data?.error || "The customer was not added.")}`);
  redirect(`/billing/customers/${result.data.id}?tab=details&saved=created`);
}

export async function saveCustomerBilling(formData) {
  const id = f(formData, "id").replace(/\D/g, "");
  const result = await call(`/v1/billing/customers/${id}`, {
    method: "PUT",
    body: {
      vatStatus: f(formData, "vatStatus"),
      vatNumber: f(formData, "vatNumber"),
      registeredName: f(formData, "registeredName"),
      billingContact: f(formData, "billingContact"),
      billingEmail: f(formData, "billingEmail"),
      billingCc: f(formData, "billingCc"),
      billingAddress: f(formData, "billingAddress"),
      paymentTermsDays: f(formData, "paymentTermsDays"),
      billingTemplate: f(formData, "billingTemplate"),
      billingReminders: formData.get("billingReminders") === "on",
    },
  });
  back(`/billing/customers/${id}?tab=details`, result, "customer", "The billing details were not saved.");
}
