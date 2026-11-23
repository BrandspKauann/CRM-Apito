export async function importFileWindow(client, account, selected, request, helpers) {
  const {readWindow, unpackPage, preparePage, writePage, markFailure, resourcePath} = helpers;
  const additional = await client.query(`SELECT stream,cursor FROM kommo_import.sync_state
    WHERE account_id=$1 AND stream LIKE 'file_links:%' AND stream<>$2
      AND status IN ('pending','retrying') AND COALESCE((cursor->>'retryAt')::bigint,0)<=$3
    ORDER BY updated_at,stream LIMIT 4`, [account.id,selected.stream,Date.now()]);
  const results = await readWindow([selected,...additional.rows], job => {
    const {spec,page} = job.cursor;
    return request(resourcePath(spec,page),spec.host,account);
  });
  const completed = [], batch = {records:[],edges:[],streams:[]};
  let rateLimited = false;
  for (const result of results) {
    const job = result.input;
    const {spec,page} = job.cursor;
    let error = result.error;
    if (!error) {
      try {
        const {rows} = unpackPage(spec,result.body,page);
        const transformed = preparePage(spec,rows,account);
        batch.records.push(...transformed.records);
        batch.edges.push(...transformed.edges);
        batch.streams.push(...transformed.streams);
        completed.push({stream:job.stream,count:rows.length});
      } catch (cause) {
        error = cause;
      }
    }
    if (error) {
      if (!error.remote && !error.importFormat) throw error;
      if (error.status===429) rateLimited = true;
      await markFailure(client,account,job.stream,job.cursor,error);
    }
  }
  if (completed.length) {
    await writePage(client,account.id,batch);
    await client.query(`UPDATE kommo_import.sync_state s SET status='complete',
      rows_seen=s.rows_seen + x.count, cursor=s.cursor-'error'-'retryAt'-'attempts', updated_at=clock_timestamp()
      FROM jsonb_to_recordset($2::jsonb) AS x(stream text,count integer)
      WHERE s.account_id=$1 AND s.stream=x.stream`,[account.id,JSON.stringify(completed)]);
  }
  return !rateLimited;
}
