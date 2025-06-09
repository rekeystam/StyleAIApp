import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Grid3x3, List, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ClothingItem } from "@shared/schema";

export function WardrobeGallery() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery<ClothingItem[]>({
    queryKey: ['/api/clothing-items'],
    staleTime: 0,
    gcTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/clothing-items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clothing-items'] });
      toast({
        title: "Item deleted",
        description: "Clothing item has been removed from your wardrobe.",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Failed to delete clothing item.",
        variant: "destructive",
      });
    },
  });

  // Get unique categories, filtering out empty/null/undefined values
  const validCategories = items
    .map(item => item.category)
    .filter(cat => cat && typeof cat === 'string' && cat.trim() !== '');
  
  const categories = ['all', ...new Set(validCategories)];
  const filteredItems = filterCategory === 'all' ? items : items.filter(item => item.category === filterCategory);

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      tops: 'bg-blue-500',
      bottoms: 'bg-indigo-600',
      dresses: 'bg-pink-400',
      outerwear: 'bg-gray-800',
      accessories: 'bg-purple-500',
      shoes: 'bg-gray-300',
    };
    return colors[category] || 'bg-gray-400';
  };

  const getStyleBadge = (style: string) => {
    const badges: Record<string, string> = {
      casual: 'Casual',
      formal: 'Formal',
      business: 'Business',
      sporty: 'Athletic',
      bohemian: 'Boho',
      vintage: 'Vintage',
      modern: 'Modern',
    };
    return badges[style] || style;
  };

  if (isLoading) {
    return (
      <section className="py-16 bg-gray-50" id="wardrobe">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
            {Array(12).fill(0).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="w-full h-48" />
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2 mb-2" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 bg-gray-50" id="wardrobe">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-2">
              Your Wardrobe
            </h2>
            <p className="text-lg text-gray-600">
              {items.length} items analyzed and categorized
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(category => (
                  <SelectItem key={category} value={category}>
                    {category === 'all' ? 'All Categories' : category.charAt(0).toUpperCase() + category.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('list')}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-gray-500">
              <h3 className="text-lg font-semibold mb-2">No items found</h3>
              <p>
                {filterCategory === 'all' 
                  ? "Upload some clothing items to get started!"
                  : `No ${filterCategory} items in your wardrobe yet.`
                }
              </p>
            </div>
          </Card>
        ) : (
          <div className={viewMode === 'grid' 
            ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6"
            : "space-y-4"
          }>
            {filteredItems.map((item) => {
              const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};

              return (
                <Card 
                  key={item.id} 
                  className={`overflow-hidden group cursor-pointer hover:shadow-lg transition-all ${
                    viewMode === 'list' ? 'flex' : ''
                  }`}
                >
                  <div className={viewMode === 'list' ? 'w-32 h-32 flex-shrink-0' : 'w-full h-48'}>
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <CardContent className={`p-4 ${viewMode === 'list' ? 'flex-1' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {item.name}
                      </span>
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${getCategoryColor(item.category)}`} />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(item.id);
                          }}
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs mb-2">
                      {getStyleBadge(item.style)}
                    </Badge>
                    {analysis.formality && (
                      <div className="flex items-center space-x-1 text-xs text-gray-600">
                        <Star className="w-3 h-3 text-yellow-400" />
                        <span className="capitalize">{analysis.formality.replace('_', ' ')}</span>
                      </div>
                    )}
                    {viewMode === 'list' && analysis.description && (
                      <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                        {analysis.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}