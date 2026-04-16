import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "wrenchpilot_contacts_v1";

export type StoredContact = {
  id: string;
  name: string;
  phone: string;
};

function load(): StoredContact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is StoredContact =>
        c && typeof c === "object" && "id" in c && "name" in c && "phone" in c
    );
  } catch {
    return [];
  }
}

export function useContacts() {
  const [contacts, setContacts] = useState<StoredContact[]>([]);

  useEffect(() => {
    setContacts(load());
  }, []);

  const persist = useCallback((next: StoredContact[]) => {
    setContacts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }, []);

  const addContact = useCallback(
    (c: { name: string; phone: string }) => {
      const phone = c.phone.trim();
      const name = c.name.trim();
      if (!phone || !name) return;
      const next = [...contacts.filter(x => digitsNorm(x.phone) !== digitsNorm(phone)), { id: nanoid(), name, phone }];
      persist(next);
    },
    [contacts, persist]
  );

  const removeContact = useCallback(
    (id: string) => {
      persist(contacts.filter(c => c.id !== id));
    },
    [contacts, persist]
  );

  const getNameForPhone = useCallback(
    (phone: string | null | undefined): string | undefined => {
      if (!phone) return undefined;
      const n = digitsNorm(phone);
      const hit = contacts.find(c => digitsNorm(c.phone) === n);
      return hit?.name;
    },
    [contacts]
  );

  return { contacts, addContact, removeContact, getNameForPhone, reload: () => setContacts(load()) };
}

function digitsNorm(p: string): string {
  return p.replace(/\D/g, "");
}
