# Cloudflare Workers Paid Tier Guide

## Why Upgrade?

Your current D1 usage exceeds the free tier limits:
- **Current**: 357k+ rows written (exceeds 100k free limit)
- **Free Tier Limits**:
  - 100k rows written/month
  - 500 MB database size
  - 5 GB total storage

## Workers Paid Plan ($5/month)

Upgrading to Workers Paid plan gives you:

### D1 Database Limits
- **Database Size**: 10 GB (vs 500 MB free) - **20x increase**
- **Rows Written**: 50 million/month included (vs 100k free) - **500x increase**
- **Rows Read**: 25 billion/month included
- **Storage**: 5 GB included, then $0.75/GB-month

### Cost Breakdown
- **Base Plan**: $5/month
- **Your Usage Estimate**:
  - ~600k rows written/month (well under 50M included) ✅
  - ~10-20 GB storage (5 GB free, ~$7.50-15/month for extra)
  - **Total Estimated**: $12.50-20/month

This fits within your $20/month budget!

## How to Upgrade

1. **Go to Cloudflare Dashboard**: https://dash.cloudflare.com
2. **Navigate to**: Workers & Pages → Overview
3. **Click**: "Upgrade to Workers Paid"
4. **Select**: Workers Paid plan ($5/month)
5. **Payment**: Add payment method

## After Upgrading

Your D1 database will automatically get the increased limits. No code changes needed!

The retention policy (30 days) will still help keep costs down by:
- Limiting historical data in D1
- Preserving all data in Parquet files (free R2 storage)
- Reducing monthly row writes

## Monitoring Usage

Check your D1 usage in Cloudflare Dashboard:
- Workers & Pages → D1 → Your Database → Usage

Monitor:
- Rows written/month
- Database size
- Storage used

## Cost Optimization Tips

1. **Keep retention at 30 days** (already implemented)
2. **Monitor monthly usage** to stay within included limits
3. **Parquet files are free** - use them for historical data
4. **R2 storage is cheap** - $0.015/GB-month

## Next Steps

1. Upgrade to Workers Paid plan
2. Run the ETL - it will now work with all tables (trips, stop_times, shapes)
3. Monitor usage for first month
4. Adjust retention if needed

