const supabaseReadPageSize = 1000;

type SupabasePage<Row> = {
  data: Row[] | null;
  error: unknown;
};

export const fetchSupabasePages = async <Row>(
  loadPage: (from: number, to: number) => PromiseLike<SupabasePage<Row>>
) => {
  const rows: Row[] = [];

  for (let from = 0; ; from += supabaseReadPageSize) {
    const { data, error } = await loadPage(from, from + supabaseReadPageSize - 1);

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Supabase select did not return rows.');
    }

    rows.push(...data);

    if (data.length < supabaseReadPageSize) {
      break;
    }
  }

  return rows;
};
