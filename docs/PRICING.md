# Pricing Engine (design)

> The engine is **implemented in Phase 2** at `lib/pricing`. This document is the
> agreed contract the data model (Phase 1) already supports. **No code outside
> `lib/pricing` may calculate jewellery prices.**

## Why dynamic pricing

Jewellery prices are **not** static. The displayed price is derived live from:

```
Metal Rate + Weight + Wastage + Making Charges + Stones/Diamonds + GST − Discounts
```

When the daily gold rate changes (e.g. ₹6,800/g → ₹7,050/g), affected catalogue
prices update automatically. The system never relies on a manually stored selling
price for dynamic products.

## Modes

### WEIGHT_BASED
```
metalValue = ratePerGram × netWeight
wastage    = metalValue × wastagePct / 100
making     = resolve(MakingChargeRule)      # %, per-gram or flat, honouring minCharge
subtotal   = metalValue + wastage + making
gst        = subtotal × gstPercent / 100
total      = subtotal + gst − discount
```

### COMPONENT_BASED
```
total = metalValue + diamondValue + stoneValue + wastage + making + gst − discount
```
`diamondValue = Σ (ratePerCarat × caratWeight × pieces)`, using the pinned
`ratePerCarat` or the linked live `DiamondRate`.

### FIXED
```
total = fixedPrice (GST applied per product config)
```

GST inclusion/exclusion follows `Product.gstInclusive` / `gstPercent`.

## Making-charge resolution order

```
Variant → Category+Metal+Purity → Category+Metal → Metal → Global
```
Highest-priority matching `MakingChargeRule` wins; `minCharge` is a floor.

## Return shape

```ts
calculatePrice(...) => {
  metalValue, diamondValue, stoneValue, making, wastage,
  discount, gst, total, rateUsed, ratePerCarat, computedAt
}
```

All arithmetic uses `Decimal` — **never** JS floating point.

## Price lock (checkout)

On checkout start: recalculate, snapshot the rates onto the order, store the lock
timestamp, and honour `StoreSetting.rateLockMinutes`. If the lock expires,
recalculate, warn the customer, and require re-confirmation — never silently
charge a different amount.

## Safety rules

- Un-computable price → show *"Price on request"* (never ₹0/₹NaN/₹undefined) and
  log the failure. `formatCurrency()` enforces this at the display layer.
- Historical orders always render from their stored snapshot, never from current
  rates.
