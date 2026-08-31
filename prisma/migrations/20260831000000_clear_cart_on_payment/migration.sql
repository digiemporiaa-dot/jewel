-- The cart is emptied when payment is confirmed, not when the order is created.
--
-- Previously `createOrder` deleted the cart items the moment the order row
-- existed. At that point the order is still PENDING_PAYMENT, so a shopper who
-- closed the Razorpay window came back to an empty bag with nothing to retry.
-- Clearing now happens where the order actually becomes real — the webhook, the
-- COD confirmation, the bank-transfer placement — and that can be minutes or
-- hours after checkout returned, so the order has to remember which bag it came
-- from.
ALTER TABLE "Order" ADD COLUMN "sessionToken" TEXT;

-- Looked up by the webhook and by the confirmation-page backstop, both of which
-- arrive with an order and need its cart.
CREATE INDEX "Order_sessionToken_idx" ON "Order"("sessionToken");
