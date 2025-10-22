/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsMerch.tsx
   -------------------------------------------------------------------------
   Admin editor for merch catalogue items.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsUploader from "./SettingsUploader";
import { normalizeAdminUrl } from "../../utils/url";

type MerchItem = {
  title: string;
  price: string;
  description: string;
  image_url: string;
  buy_url: string;
};

type MerchSettings = {
  merch_title: string;
  merch_intro: string;
  merch_items: MerchItem[];
};

const sanitizeItems = (value: unknown): MerchItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title : "",
        price: typeof obj.price === "string" ? obj.price : "",
        description: typeof obj.description === "string" ? obj.description : "",
        image_url: typeof obj.image_url === "string" ? obj.image_url : "",
        buy_url: typeof obj.buy_url === "string" ? obj.buy_url : "",
      };
    });
};

const sanitize = (raw: unknown): MerchSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    merch_title: typeof safe.merch_title === "string" ? safe.merch_title : "Merch",
    merch_intro:
      typeof safe.merch_intro === "string"
        ? safe.merch_intro
        : "Rep Too Funny Productions with tees, hoodies, mugs, and more.",
    merch_items: sanitizeItems(safe.merch_items),
  };
};

const blankItem: MerchItem = { title: "", price: "", description: "", image_url: "", buy_url: "" };

export default function AdminSettingsMerch(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<MerchSettings>(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof MerchSettings>(key: K, value: MerchSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const updateItem = (index: number, patch: Partial<MerchItem>) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextItems = prev.merch_items.map((item, idx) => {
        if (idx !== index) return item;
        const next: MerchItem = { ...item, ...patch };
        if (typeof patch.image_url === "string") {
          next.image_url = normalizeAdminUrl(patch.image_url);
        }
        if (typeof patch.buy_url === "string") {
          next.buy_url = normalizeAdminUrl(patch.buy_url);
        }
        return next;
      });
      setField("merch_items", nextItems);
      return { ...prev, merch_items: nextItems };
    });
  };

  const addItem = () => {
    if (disabled) return;
    const next = [...local.merch_items, { ...blankItem }];
    setLocal((prev) => ({ ...prev, merch_items: next }));
    setField("merch_items", next);
  };

  const removeItem = (index: number) => {
    if (disabled) return;
    const next = local.merch_items.filter((_, idx) => idx !== index);
    setLocal((prev) => ({ ...prev, merch_items: next }));
    setField("merch_items", next);
  };

  return (
    <div className="space-y-8">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <label className="block text-sm font-semibold mb-1">Merch Page Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.merch_title}
            onChange={(event) => updateField("merch_title", event.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Intro Paragraph</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[100px]"
            value={local.merch_intro}
            onChange={(event) => updateField("merch_intro", event.target.value)}
            disabled={disabled}
          />
        </div>
      </section>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Products</h3>
        <button
          type="button"
          onClick={addItem}
          disabled={disabled}
          className={`rounded px-3 py-2 text-sm font-semibold ${
            disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          Add merch item
        </button>
      </div>

      {local.merch_items.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
          No merch items yet. Add a product to feature it on the site.
        </p>
      ) : (
        <div className="space-y-6">
          {local.merch_items.map((item, index) => (
            <div key={index} className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <SettingsUploader
                  label="Product image"
                  value={item.image_url}
                  onChange={(url) => updateItem(index, { image_url: url })}
                  accept="image/*"
                  buttonLabel="Upload image"
                  disabled={disabled}
                  pickerKind="image"
                />

                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-semibold">
                      Title
                      <input
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                        value={item.title}
                        onChange={(event) => updateItem(index, { title: event.target.value })}
                        disabled={disabled}
                      />
                    </label>
                    <label className="text-sm font-semibold">
                      Price
                      <input
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                        placeholder="$25"
                        value={item.price}
                        onChange={(event) => updateItem(index, { price: event.target.value })}
                        disabled={disabled}
                      />
                    </label>
                  </div>

                  <label className="text-sm font-semibold block">
                    Description
                    <textarea
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black min-h-[80px]"
                      value={item.description}
                      onChange={(event) => updateItem(index, { description: event.target.value })}
                      disabled={disabled}
                    />
                  </label>

                  <label className="text-sm font-semibold block">
                    Purchase link
                    <input
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                      placeholder="https://store.example.com/product"
                      value={item.buy_url}
                      onChange={(event) => updateItem(index, { buy_url: event.target.value })}
                      disabled={disabled}
                    />
                  </label>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      disabled={disabled}
                      className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove item
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

