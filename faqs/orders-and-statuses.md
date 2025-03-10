---
description: >-
  Common questions about order and statuses when using Fundpop for your
  crowdfunding campaigns
---

# 📦 Orders and Statuses

## How do order statuses change for mixed pre-order campaigns?

When an order contains multiple pre-order products from different campaigns, the order status will change throughout the lifecycle of the campaigns. Here's how it works:

**Initial Status After Checkout**

* If the order only contains pre-order items, the status will be **Pending**
* If the order includes a pledge fee or regular (non-pre-order) products, the status will be **Partially Paid**

**When First Campaign Ends**

* When the first campaign reaches its end date, the status changes to **Paid**
* At this point, ALL pre-order items in the order are charged (not just items from the first campaign)
* This happens because Shopify processes all deferred payments in an order based on the earliest due date

**If Later Campaigns Fail**

* If a later (All-or-nothing) campaign fails, we automatically initiate a refund for items from that campaign only
* The order status changes to **Partially Refunded**
* Items from successful campaigns remain paid and are not affected

For example: An order contains pre-order Product A (Campaign 1) and pre-order Product B (Campaign 2):

1. Initial status: **Pending**
2. Campaign 1 succeeds and reaches end date: Status becomes **Paid** (both A and B are charged)
3. Campaign 2 fails: Status becomes **Partially Refunded** (refund issued for Product B only)

