---
description: >-
  Common questions about payments and fees when using Fundpop for your
  crowdfunding campaigns
---

# 💵 Payments and Fees

## How are payments handled for items from different pre-order campaigns in the same order?

Due to [Shopify's single payment capture date limitation](https://shopify.dev/docs/apps/build/purchase-options/deferred#limitations), when a customer orders pre-order items from multiple campaigns in the same order, all items will be charged when the earliest campaign ends. Here's how different campaign combinations are handled:

1. Multiple All-or-nothing Campaigns:
   * All items are charged when the earliest campaign ends
   * Each campaign's success/failure is handled independently:
     * If a campaign fails: Refund only items from that campaign
     * Success/failure of one campaign doesn't affect items from other campaigns
2. Mix of All-or-nothing and Flexible Campaigns:
   * All items are charged when the earliest campaign ends
   * For All-or-nothing campaigns: Refund items only from campaigns that fail
   * For Flexible campaigns: Items keep payment regardless of goals
3. Multiple Flexible Campaigns:
   * All items are charged when the earliest campaign ends
   * All items keep payments regardless of goals
   * No refunds needed

Example: A customer orders items from three campaigns in the same order:

* Item A from Campaign 1 (All-or-nothing, ending March 1)
* Item B from Campaign 2 (All-or-nothing, ending March 1)
* Item C from Campaign 3 (Flexible, ending March 15)

All items will be charged on March 1. Even though Campaign 1 and 2 end on the same date, their success/failure is evaluated independently. If Campaign 1 fails but Campaign 2 succeeds, only Item A needs to be cancelled. If both Campaign 1 and 2 fail, both Item A and B would need to be cancelled. Item C keeps its payment regardless of Campaign 3's outcome since it's a flexible campaign.

{% hint style="success" %}
Pro tip: Use the order status filters to focus on orders that need immediate attention, such as processing pending payments or handling partially paid orders.
{% endhint %}

